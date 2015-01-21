"use strict";

var _toArray = function (arr) {
  return Array.isArray(arr) ? arr : Array.from(arr);
};

var _extends = function (child, parent) {
  child.prototype = Object.create(parent.prototype, {
    constructor: {
      value: child,
      enumerable: false,
      writable: true,
      configurable: true
    }
  });
  child.__proto__ = parent;
};

var Shift = require("shift-ast");

var isRestrictedWord = require("./utils").isRestrictedWord;
var isStrictModeReservedWordES5 = require("./utils").isStrictModeReservedWordES5;
var ErrorMessages = require("./errors").ErrorMessages;
var Tokenizer = require("./tokenizer")["default"];
var TokenClass = require("./tokenizer").TokenClass;
var TokenType = require("./tokenizer").TokenType;
var IdentifierToken = require("./tokenizer").IdentifierToken;
var IdentifierLikeToken = require("./tokenizer").IdentifierLikeToken;
var NumericLiteralToken = require("./tokenizer").NumericLiteralToken;
var StringLiteralToken = require("./tokenizer").StringLiteralToken;


var INIT_MASK = 1;
var GETTER_MASK = 2;
var SETTER_MASK = 4;

var STRICT_MODE_RESERVED_WORD = ["implements", "interface", "package", "private", "protected", "public", "static", "yield", "let"];

var Precedence = {
  Sequence: 0,
  Yield: 1,
  Assignment: 1,
  Conditional: 2,
  ArrowFunction: 2,
  LogicalOR: 3,
  LogicalAND: 4,
  BitwiseOR: 5,
  BitwiseXOR: 6,
  BitwiseAND: 7,
  Equality: 8,
  Relational: 9,
  BitwiseSHIFT: 10,
  Additive: 11,
  Multiplicative: 12,
  Unary: 13,
  Postfix: 14,
  Call: 15,
  New: 16,
  TaggedTemplate: 17,
  Member: 18,
  Primary: 19
};

var BinaryPrecedence = {
  "||": Precedence.LogicalOR,
  "&&": Precedence.LogicalAND,
  "|": Precedence.BitwiseOR,
  "^": Precedence.BitwiseXOR,
  "&": Precedence.BitwiseAND,
  "==": Precedence.Equality,
  "!=": Precedence.Equality,
  "===": Precedence.Equality,
  "!==": Precedence.Equality,
  "<": Precedence.Relational,
  ">": Precedence.Relational,
  "<=": Precedence.Relational,
  ">=": Precedence.Relational,
  "in": Precedence.Relational,
  "instanceof": Precedence.Relational,
  "<<": Precedence.BitwiseSHIFT,
  ">>": Precedence.BitwiseSHIFT,
  ">>>": Precedence.BitwiseSHIFT,
  "+": Precedence.Additive,
  "-": Precedence.Additive,
  "*": Precedence.Multiplicative,
  "%": Precedence.Multiplicative,
  "/": Precedence.Multiplicative };

var Parser = (function (Tokenizer) {
  var Parser = function Parser(source) {
    Tokenizer.call(this, source);
    this.labelSet = Object.create(null);
    this.allowIn = true;
    this.inIteration = false;
    this.inSwitch = false;
    this.inFunctionBody = false;
  };

  _extends(Parser, Tokenizer);

  Parser.prototype.eat = function (tokenType) {
    if (this.lookahead.type === tokenType) {
      return this.lex();
    }
  };

  Parser.prototype.expect = function (tokenType) {
    if (this.lookahead.type === tokenType) {
      return this.lex();
    }
    throw this.createUnexpected(this.lookahead);
  };

  Parser.prototype.match = function (subType) {
    return this.lookahead.type === subType;
  };

  Parser.prototype.consumeSemicolon = function () {
    // Catch the very common case first: immediately a semicolon (U+003B).
    if (this.index < this.source.length && this.source.charAt(this.index) == ";") {
      this.lex();
      return;
    }

    this.index = this.lookahead.slice.start;
    if (this.hasLineTerminatorBeforeNext) {
      return;
    }

    if (this.match(TokenType.SEMICOLON)) {
      this.lex();
      return;
    }

    if (!this.eof() && !this.match(TokenType.RBRACE)) {
      throw this.createUnexpected(this.lookahead);
    }
  };

  Parser.prototype.markLocation = function (node, startTokenIndex, endTokenIndex) {
    if (endTokenIndex === undefined) endTokenIndex = this.tokenIndex;
    // TODO: mark the source locations.
    return node;
  };

  Parser.prototype.parseScript = function () {
    var _ref = this.parseBody(true);

    var _ref2 = _toArray(_ref);

    var body = _ref2[0];
    var isStrict = _ref2[1];
    return new Shift.Script(this.markLocation(body, 0));
  };

  Parser.prototype.parseFunctionBody = function () {
    var previousStrict = this.strict;
    var startTokenIndex = this.tokenIndex;

    var oldLabelSet = this.labelSet;
    var oldInIteration = this.inIteration;
    var oldInSwitch = this.inSwitch;
    var oldInFunctionBody = this.inFunctionBody;

    this.labelSet = Object.create(null);
    this.inIteration = false;
    this.inSwitch = false;
    this.inFunctionBody = true;

    this.expect(TokenType.LBRACE);
    var _ref3 = this.parseBody();

    var _ref4 = _toArray(_ref3);

    var body = _ref4[0];
    var isStrict = _ref4[1];
    this.expect(TokenType.RBRACE);

    body = this.markLocation(body, startTokenIndex);

    this.labelSet = oldLabelSet;
    this.inIteration = oldInIteration;
    this.inSwitch = oldInSwitch;
    this.inFunctionBody = oldInFunctionBody;
    this.strict = previousStrict;
    return [body, isStrict];
  };

  Parser.prototype.parseBody = function (acceptEOF) {
    if (acceptEOF === undefined) acceptEOF = false;
    var directives = [];
    var statements = [];
    var parsingDirectives = true;
    var isStrict = this.strict;
    var firstRestricted = null;
    while (true) {
      if (acceptEOF) {
        if (this.eof()) {
          break;
        }
      } else {
        if (this.match(TokenType.RBRACE)) {
          break;
        }
      }
      var token = this.lookahead;
      var text = token.slice.text;
      var isStringLiteral = token instanceof StringLiteralToken;
      var stmt = this.parseStatement();
      if (parsingDirectives) {
        if (isStringLiteral && stmt.type === "ExpressionStatement" && stmt.expression.type === "LiteralStringExpression") {
          if (text === "\"use strict\"" || text === "'use strict'") {
            directives.push(new Shift.UseStrictDirective());
            isStrict = true;
            this.strict = true;
            if (firstRestricted != null) {
              throw this.createErrorWithToken(firstRestricted, ErrorMessages.STRICT_OCTAL_LITERAL);
            }
          } else {
            directives.push(new Shift.UnknownDirective(stmt.expression.value));
            if (firstRestricted == null && token.octal) {
              firstRestricted = token;
            }
          }
        } else {
          parsingDirectives = false;
          statements.push(stmt);
        }
      } else {
        statements.push(stmt);
      }
    }

    return [new Shift.FunctionBody(directives, statements), isStrict];
  };

  Parser.prototype.parseStatement = function () {
    var startTokenIndex = this.tokenIndex;
    if (this.eof()) {
      throw this.createUnexpected(this.lookahead);
    }
    switch (this.lookahead.type) {
      case TokenType.SEMICOLON:
        return this.markLocation(this.parseEmptyStatement(), startTokenIndex);
      case TokenType.LBRACE:
        return this.markLocation(this.parseBlockStatement(), startTokenIndex);
      case TokenType.LPAREN:
        return this.markLocation(this.parseExpressionStatement(), startTokenIndex);
      case TokenType.BREAK:
        return this.markLocation(this.parseBreakStatement(), startTokenIndex);
      case TokenType.CONTINUE:
        return this.markLocation(this.parseContinueStatement(), startTokenIndex);
      case TokenType.DEBUGGER:
        return this.markLocation(this.parseDebuggerStatement(), startTokenIndex);
      case TokenType.DO:
        return this.markLocation(this.parseDoWhileStatement(), startTokenIndex);
      case TokenType.FOR:
        return this.markLocation(this.parseForStatement(), startTokenIndex);
      case TokenType.FUNCTION:
        return this.markLocation(this.parseFunction(false), startTokenIndex);
      case TokenType.IF:
        return this.markLocation(this.parseIfStatement(), startTokenIndex);
      case TokenType.RETURN:
        return this.markLocation(this.parseReturnStatement(), startTokenIndex);
      case TokenType.SWITCH:
        return this.markLocation(this.parseSwitchStatement(), startTokenIndex);
      case TokenType.THROW:
        return this.markLocation(this.parseThrowStatement(), startTokenIndex);
      case TokenType.TRY:
        return this.markLocation(this.parseTryStatement(), startTokenIndex);
      case TokenType.VAR:
      case TokenType.LET:
      case TokenType.CONST:
        return this.markLocation(this.parseVariableDeclarationStatement(), startTokenIndex);
      case TokenType.WHILE:
        return this.markLocation(this.parseWhileStatement(), startTokenIndex);
      case TokenType.WITH:
        return this.markLocation(this.parseWithStatement(), startTokenIndex);
      default:
        {
          var expr = this.parseExpression()[0];

          // 12.12 Labelled Statements;
          if (expr.type === "IdentifierExpression" && this.match(TokenType.COLON)) {
            this.lex();
            var key = "$" + expr.identifier.name;
            if ({}.hasOwnProperty.call(this.labelSet, key)) {
              throw this.createError(ErrorMessages.LABEL_REDECLARATION, expr.identifier.name);
            }

            this.labelSet[key] = true;
            var labeledBody = this.parseStatement();
            delete this.labelSet[key];
            return this.markLocation(new Shift.LabeledStatement(expr.identifier, labeledBody), startTokenIndex);
          } else {
            this.consumeSemicolon();
            return this.markLocation(new Shift.ExpressionStatement(expr), startTokenIndex);
          }
        }
    }
  };

  Parser.prototype.parseVariableIdentifier = function () {
    var startTokenIndex = this.tokenIndex;

    var token = this.lex();
    if (!(token instanceof IdentifierToken)) {
      throw this.createUnexpected(token);
    }

    return this.markLocation(new Shift.Identifier(token.value), startTokenIndex);
  };

  Parser.prototype.parseEmptyStatement = function () {
    this.expect(TokenType.SEMICOLON);
    return new Shift.EmptyStatement();
  };

  Parser.prototype.parseBlockStatement = function () {
    return new Shift.BlockStatement(this.parseBlock());
  };

  Parser.prototype.parseExpressionStatement = function () {
    var expr = this.parseExpression()[0];
    this.consumeSemicolon();
    return new Shift.ExpressionStatement(expr);
  };

  Parser.prototype.parseBreakStatement = function () {
    var token = this.lookahead;
    this.expect(TokenType.BREAK);

    // Catch the very common case first: immediately a semicolon (U+003B).
    if (this.lookahead.type == TokenType.SEMICOLON) {
      this.lex();

      if (!(this.inIteration || this.inSwitch)) {
        throw this.createErrorWithToken(token, ErrorMessages.ILLEGAL_BREAK);
      }

      return new Shift.BreakStatement(null);
    }

    if (this.hasLineTerminatorBeforeNext) {
      if (!(this.inIteration || this.inSwitch)) {
        throw this.createErrorWithToken(token, ErrorMessages.ILLEGAL_BREAK);
      }

      return new Shift.BreakStatement(null);
    }

    var label = null;
    if (this.lookahead.type == TokenType.IDENTIFIER) {
      label = this.parseVariableIdentifier();

      var key = "$" + label.name;
      if (!{}.hasOwnProperty.call(this.labelSet, key)) {
        throw this.createError(ErrorMessages.UNKNOWN_LABEL, label.name);
      }
    }

    this.consumeSemicolon();

    if (label == null && !(this.inIteration || this.inSwitch)) {
      throw this.createErrorWithToken(token, ErrorMessages.ILLEGAL_BREAK);
    }

    return new Shift.BreakStatement(label);
  };

  Parser.prototype.parseContinueStatement = function () {
    var token = this.lookahead;
    this.expect(TokenType.CONTINUE);

    // Catch the very common case first: immediately a semicolon (U+003B).
    if (this.lookahead.type == TokenType.SEMICOLON) {
      this.lex();
      if (!this.inIteration) {
        throw this.createErrorWithToken(token, ErrorMessages.ILLEGAL_CONTINUE);
      }

      return new Shift.ContinueStatement(null);
    }

    if (this.hasLineTerminatorBeforeNext) {
      if (!this.inIteration) {
        throw this.createErrorWithToken(token, ErrorMessages.ILLEGAL_CONTINUE);
      }

      return new Shift.ContinueStatement(null);
    }

    var label = null;
    if (this.lookahead.type == TokenType.IDENTIFIER) {
      label = this.parseVariableIdentifier();

      var key = "$" + label.name;
      if (!{}.hasOwnProperty.call(this.labelSet, key)) {
        throw this.createError(ErrorMessages.UNKNOWN_LABEL, label.name);
      }
    }

    this.consumeSemicolon();
    if (!this.inIteration) {
      throw this.createErrorWithToken(token, ErrorMessages.ILLEGAL_CONTINUE);
    }

    return new Shift.ContinueStatement(label);
  };

  Parser.prototype.parseDebuggerStatement = function () {
    this.expect(TokenType.DEBUGGER);
    this.consumeSemicolon();
    return new Shift.DebuggerStatement();
  };

  Parser.prototype.parseDoWhileStatement = function () {
    this.expect(TokenType.DO);
    var oldInIteration = this.inIteration;
    this.inIteration = true;

    var body = this.parseStatement();
    this.inIteration = oldInIteration;

    this.expect(TokenType.WHILE);
    this.expect(TokenType.LPAREN);
    var test = this.parseExpression()[0];
    this.expect(TokenType.RPAREN);
    if (this.match(TokenType.SEMICOLON)) {
      this.lex();
    }

    return new Shift.DoWhileStatement(body, test);
  };

  Parser.isLeftHandSide = function (expr) {
    switch (expr.type) {
      case "CallExpression":
      case "NewExpression":
      case "StaticMemberExpression":
      case "ComputedMemberExpression":
      case "ArrayExpression":
      case "FunctionExpression":
      case "IdentifierExpression":
      case "LiteralBooleanExpression":
      case "LiteralStringExpression":
      case "LiteralNullExpression":
      case "LiteralRegExpExpression":
      case "ObjectExpression":
      case "ThisExpression":
        return true;
    }
    return false;
  };

  Parser.prototype.parseForStatement = function () {
    this.expect(TokenType.FOR);
    this.expect(TokenType.LPAREN);
    var test = null;
    var right = null;
    if (this.match(TokenType.SEMICOLON)) {
      this.lex();
      if (!this.match(TokenType.SEMICOLON)) {
        test = this.parseExpression()[0];
      }
      this.expect(TokenType.SEMICOLON);
      if (!this.match(TokenType.RPAREN)) {
        right = this.parseExpression()[0];
      }
      return new Shift.ForStatement(null, test, right, this.getIteratorStatementEpilogue());
    } else {
      if (this.match(TokenType.VAR) || this.match(TokenType.LET)) {
        var previousAllowIn = this.allowIn;
        this.allowIn = false;
        var initDecl = this.parseVariableDeclaration();
        this.allowIn = previousAllowIn;

        if (initDecl.declarators.length === 1 && this.match(TokenType.IN)) {
          this.lex();
          right = this.parseExpression()[0];
          return new Shift.ForInStatement(initDecl, right, this.getIteratorStatementEpilogue());
        } else {
          this.expect(TokenType.SEMICOLON);
          if (!this.match(TokenType.SEMICOLON)) {
            test = this.parseExpression()[0];
          }
          this.expect(TokenType.SEMICOLON);
          if (!this.match(TokenType.RPAREN)) {
            right = this.parseExpression()[0];
          }
          return new Shift.ForStatement(initDecl, test, right, this.getIteratorStatementEpilogue());
        }
      } else {
        var previousAllowIn = this.allowIn;
        this.allowIn = false;
        var _ref5 = this.parseExpression();

        var _ref6 = _toArray(_ref5);

        var init = _ref6[0];
        var _isLeftHandSide = _ref6[1];
        this.allowIn = previousAllowIn;

        if (this.match(TokenType.IN)) {
          if (!_isLeftHandSide) {
            throw this.createError(ErrorMessages.INVALID_LHS_IN_FOR_IN);
          }

          this.lex();
          right = this.parseExpression()[0];
          return new Shift.ForInStatement(init, right, this.getIteratorStatementEpilogue());
        } else {
          this.expect(TokenType.SEMICOLON);
          if (!this.match(TokenType.SEMICOLON)) {
            test = this.parseExpression()[0];
          }
          this.expect(TokenType.SEMICOLON);
          if (!this.match(TokenType.RPAREN)) {
            right = this.parseExpression()[0];
          }
          return new Shift.ForStatement(init, test, right, this.getIteratorStatementEpilogue());
        }
      }
    }
  };

  Parser.prototype.getIteratorStatementEpilogue = function () {
    this.expect(TokenType.RPAREN);
    var oldInIteration = this.inIteration;
    this.inIteration = true;
    var body = this.parseStatement();
    this.inIteration = oldInIteration;
    return body;
  };

  Parser.prototype.parseIfStatement = function () {
    this.expect(TokenType.IF);
    this.expect(TokenType.LPAREN);
    var test = this.parseExpression()[0];

    this.expect(TokenType.RPAREN);
    var consequent = this.parseStatement();
    var alternate = null;
    if (this.match(TokenType.ELSE)) {
      this.lex();
      alternate = this.parseStatement();
    }
    return new Shift.IfStatement(test, consequent, alternate);
  };

  Parser.prototype.parseReturnStatement = function () {
    var argument = null;

    this.expect(TokenType.RETURN);
    if (!this.inFunctionBody) {
      throw this.createError(ErrorMessages.ILLEGAL_RETURN);
    }

    if (this.hasLineTerminatorBeforeNext) {
      return new Shift.ReturnStatement(null);
    }

    if (!this.match(TokenType.SEMICOLON)) {
      if (!this.match(TokenType.RBRACE) && !this.eof()) {
        argument = this.parseExpression()[0];
      }
    }

    this.consumeSemicolon();
    return new Shift.ReturnStatement(argument);
  };

  Parser.prototype.parseWithStatement = function () {
    if (this.strict) {
      throw this.createError(ErrorMessages.STRICT_MODE_WITH);
    }

    this.expect(TokenType.WITH);
    this.expect(TokenType.LPAREN);
    var object = this.parseExpression()[0];
    this.expect(TokenType.RPAREN);
    var body = this.parseStatement();

    return new Shift.WithStatement(object, body);
  };

  Parser.prototype.parseSwitchStatement = function () {
    this.expect(TokenType.SWITCH);
    this.expect(TokenType.LPAREN);
    var discriminant = this.parseExpression()[0];
    this.expect(TokenType.RPAREN);
    this.expect(TokenType.LBRACE);

    if (this.match(TokenType.RBRACE)) {
      this.lex();
      return new Shift.SwitchStatement(discriminant, []);
    }
    var oldInSwitch = this.inSwitch;
    this.inSwitch = true;

    var cases = this.parseSwitchCases();

    if (this.match(TokenType.DEFAULT)) {
      var switchDefault = this.parseSwitchDefault();
      var postDefaultCases = this.parseSwitchCases();
      if (this.match(TokenType.DEFAULT)) {
        throw this.createError(ErrorMessages.MULTIPLE_DEFAULTS_IN_SWITCH);
      }
      this.inSwitch = oldInSwitch;
      this.expect(TokenType.RBRACE);
      return new Shift.SwitchStatementWithDefault(discriminant, cases, switchDefault, postDefaultCases);
    } else {
      this.inSwitch = oldInSwitch;
      this.expect(TokenType.RBRACE);
      return new Shift.SwitchStatement(discriminant, cases);
    }
  };

  Parser.prototype.parseSwitchCases = function () {
    var result = [];
    while (!(this.eof() || this.match(TokenType.RBRACE) || this.match(TokenType.DEFAULT))) {
      result.push(this.parseSwitchCase());
    }
    return result;
  };

  Parser.prototype.parseSwitchCase = function () {
    var startTokenIndex = this.tokenIndex;
    this.expect(TokenType.CASE);
    return this.markLocation(new Shift.SwitchCase(this.parseExpression()[0], this.parseSwitchCaseBody()), startTokenIndex);
  };

  Parser.prototype.parseSwitchDefault = function () {
    var startTokenIndex = this.tokenIndex;
    this.expect(TokenType.DEFAULT);
    return this.markLocation(new Shift.SwitchDefault(this.parseSwitchCaseBody()), startTokenIndex);
  };

  Parser.prototype.parseSwitchCaseBody = function () {
    this.expect(TokenType.COLON);
    return this.parseStatementListInSwitchCaseBody();
  };

  Parser.prototype.parseStatementListInSwitchCaseBody = function () {
    var result = [];
    while (!(this.eof() || this.match(TokenType.RBRACE) || this.match(TokenType.DEFAULT) || this.match(TokenType.CASE))) {
      result.push(this.parseStatement());
    }
    return result;
  };

  Parser.prototype.parseThrowStatement = function () {
    var token = this.expect(TokenType.THROW);

    if (this.hasLineTerminatorBeforeNext) {
      throw this.createErrorWithToken(token, ErrorMessages.NEWLINE_AFTER_THROW);
    }

    var argument = this.parseExpression()[0];

    this.consumeSemicolon();

    return new Shift.ThrowStatement(argument);
  };

  Parser.prototype.parseTryStatement = function () {
    this.expect(TokenType.TRY);
    var block = this.parseBlock();

    if (this.match(TokenType.CATCH)) {
      var handler = this.parseCatchClause();
      if (this.match(TokenType.FINALLY)) {
        this.lex();
        var finalizer = this.parseBlock();
        return new Shift.TryFinallyStatement(block, handler, finalizer);
      }
      return new Shift.TryCatchStatement(block, handler);
    }

    if (this.match(TokenType.FINALLY)) {
      this.lex();
      var finalizer = this.parseBlock();
      return new Shift.TryFinallyStatement(block, null, finalizer);
    } else {
      throw this.createError(ErrorMessages.NO_CATCH_OR_FINALLY);
    }
  };

  Parser.prototype.parseVariableDeclarationStatement = function () {
    var declaration = this.parseVariableDeclaration();
    this.consumeSemicolon();
    return new Shift.VariableDeclarationStatement(declaration);
  };

  Parser.prototype.parseWhileStatement = function () {
    this.expect(TokenType.WHILE);
    this.expect(TokenType.LPAREN);
    return new Shift.WhileStatement(this.parseExpression()[0], this.getIteratorStatementEpilogue());
  };

  Parser.prototype.parseCatchClause = function () {
    var startTokenIndex = this.tokenIndex;

    this.expect(TokenType.CATCH);
    this.expect(TokenType.LPAREN);
    if (this.match(TokenType.RPAREN)) {
      throw this.createUnexpected(this.lookahead);
    }

    var param = this.parseVariableIdentifier();

    // 12.14.1;
    if (this.strict && isRestrictedWord(param.name)) {
      throw this.createError(ErrorMessages.STRICT_CATCH_VARIABLE);
    }

    this.expect(TokenType.RPAREN);

    var body = this.parseBlock();

    return this.markLocation(new Shift.CatchClause(param, body), startTokenIndex);
  };

  Parser.prototype.parseBlock = function () {
    var startTokenIndex = this.tokenIndex;
    this.expect(TokenType.LBRACE);

    var body = [];
    while (!this.match(TokenType.RBRACE)) {
      body.push(this.parseStatement());
    }
    this.expect(TokenType.RBRACE);

    return this.markLocation(new Shift.Block(body), startTokenIndex);
  };

  Parser.prototype.parseVariableDeclaration = function () {
    var startTokenIndex = this.tokenIndex;
    var token = this.lex();

    // Preceded by this.match(TokenSubType.VAR) || this.match(TokenSubType.LET);
    var kind = token.type == TokenType.VAR ? "var" : token.type === TokenType.CONST ? "const" : "let";
    var declarators = this.parseVariableDeclaratorList(kind);
    return this.markLocation(new Shift.VariableDeclaration(kind, declarators), startTokenIndex);
  };

  Parser.prototype.parseVariableDeclaratorList = function (kind) {
    var result = [];
    while (true) {
      result.push(this.parseVariableDeclarator(kind));
      if (!this.eat(TokenType.COMMA)) {
        return result;
      }
    }
  };

  Parser.prototype.parseVariableDeclarator = function (kind) {
    var startTokenIndex = this.tokenIndex;

    var id = this.parseVariableIdentifier();

    // 12.2.1;
    if (this.strict && isRestrictedWord(id.name)) {
      throw this.createError(ErrorMessages.STRICT_VAR_NAME);
    }

    var init = null;
    if (kind == "const") {
      this.expect(TokenType.ASSIGN);
      init = this.parseAssignmentExpression()[0];
    } else if (this.match(TokenType.ASSIGN)) {
      this.lex();
      init = this.parseAssignmentExpression()[0];
    }
    return this.markLocation(new Shift.VariableDeclarator(id, init), startTokenIndex);
  };

  Parser.prototype.parseExpression = function () {
    var startTokenIndex = this.tokenIndex;

    var _ref7 = this.parseAssignmentExpression();

    var _ref8 = _toArray(_ref7);

    var expr = _ref8[0];
    var _isLeftHandSide2 = _ref8[1];


    if (this.match(TokenType.COMMA)) {
      while (!this.eof()) {
        if (!this.match(TokenType.COMMA)) {
          break;
        }
        this.lex();
        expr = this.markLocation(new Shift.BinaryExpression(",", expr, this.parseAssignmentExpression()[0]), startTokenIndex);
        _isLeftHandSide2 = false;
      }
    }
    return [expr, _isLeftHandSide2];
  };

  Parser.prototype.parseAssignmentExpression = function () {
    var token = this.lookahead;
    var startTokenIndex = this.tokenIndex;

    var _ref9 = this.parseConditionalExpression();

    var _ref10 = _toArray(_ref9);

    var node = _ref10[0];
    var _isLeftHandSide3 = _ref10[1];


    var isOperator = false;
    var operator = this.lookahead;
    switch (operator.type) {
      case TokenType.ASSIGN:
      case TokenType.ASSIGN_BIT_OR:
      case TokenType.ASSIGN_BIT_XOR:
      case TokenType.ASSIGN_BIT_AND:
      case TokenType.ASSIGN_SHL:
      case TokenType.ASSIGN_SHR:
      case TokenType.ASSIGN_SHR_UNSIGNED:
      case TokenType.ASSIGN_ADD:
      case TokenType.ASSIGN_SUB:
      case TokenType.ASSIGN_MUL:
      case TokenType.ASSIGN_DIV:
      case TokenType.ASSIGN_MOD:
        isOperator = true;
        break;
    }

    if (isOperator) {
      if (!_isLeftHandSide3) {
        throw this.createError(ErrorMessages.INVALID_LHS_IN_ASSIGNMENT);
      }

      // 11.13.1;
      if (node.type === "IdentifierExpression") {
        if (this.strict && isRestrictedWord(node.identifier.name)) {
          throw this.createErrorWithToken(token, ErrorMessages.STRICT_LHS_ASSIGNMENT);
        }
      }

      this.lex();
      var right = this.parseAssignmentExpression()[0];
      node = this.markLocation(new Shift.AssignmentExpression(operator.type.name, node, right), startTokenIndex);
      _isLeftHandSide3 = false;
    }
    return [node, _isLeftHandSide3];
  };

  Parser.prototype.parseConditionalExpression = function () {
    var startTokenIndex = this.tokenIndex;
    var _ref11 = this.parseBinaryExpression();

    var _ref12 = _toArray(_ref11);

    var expr = _ref12[0];
    var _isLeftHandSide4 = _ref12[1];
    if (this.match(TokenType.CONDITIONAL)) {
      this.lex();
      var previousAllowIn = this.allowIn;
      this.allowIn = true;
      var consequent = this.parseAssignmentExpression()[0];
      this.allowIn = previousAllowIn;
      this.expect(TokenType.COLON);
      var alternate = this.parseAssignmentExpression()[0];
      expr = this.markLocation(new Shift.ConditionalExpression(expr, consequent, alternate), startTokenIndex);
      _isLeftHandSide4 = false;
    }

    return [expr, _isLeftHandSide4];
  };

  Parser.prototype.isBinaryOperator = function (type) {
    switch (type) {
      case TokenType.OR:
      case TokenType.AND:
      case TokenType.BIT_OR:
      case TokenType.BIT_XOR:
      case TokenType.BIT_AND:
      case TokenType.EQ:
      case TokenType.NE:
      case TokenType.EQ_STRICT:
      case TokenType.NE_STRICT:
      case TokenType.LT:
      case TokenType.GT:
      case TokenType.LTE:
      case TokenType.GTE:
      case TokenType.INSTANCEOF:
      case TokenType.SHL:
      case TokenType.SHR:
      case TokenType.SHR_UNSIGNED:
      case TokenType.ADD:
      case TokenType.SUB:
      case TokenType.MUL:
      case TokenType.DIV:
      case TokenType.MOD:
        return true;
      case TokenType.IN:
        return this.allowIn;
      default:
        return false;
    }
  };

  Parser.prototype.parseBinaryExpression = function () {
    var _this = this;
    var _ref13 = this.parseUnaryExpression();

    var _ref14 = _toArray(_ref13);

    var left = _ref14[0];
    var _isLeftHandSide5 = _ref14[1];
    var operator = this.lookahead.type;

    var _isBinaryOperator = this.isBinaryOperator(operator);
    if (!_isBinaryOperator) {
      return [left, _isLeftHandSide5];
    }

    this.lex();
    var stack = [];
    stack.push({ startIndex: this.tokenIndex, left: left, operator: operator, precedence: BinaryPrecedence[operator.name] });
    var right = this.parseUnaryExpression()[0];

    operator = this.lookahead.type;
    _isBinaryOperator = this.isBinaryOperator(this.lookahead.type);
    while (_isBinaryOperator) {
      var precedence = BinaryPrecedence[operator.name];
      // Reduce: make a binary expression from the three topmost entries.
      while (stack.length && (precedence <= stack[stack.length - 1].precedence)) {
        var stackItem = stack[stack.length - 1];
        var stackOperator = stackItem.operator;
        left = stackItem.left;
        stack.pop();
        right = this.markLocation(new Shift.BinaryExpression(stackOperator.name, left, right), stackItem.startIndex, this.tokenIndex);
      }

      // Shift.
      this.lex();
      stack.push({ startIndex: this.tokenIndex, left: right, operator: operator, precedence: precedence });
      right = this.parseUnaryExpression()[0];

      operator = this.lookahead.type;
      _isBinaryOperator = this.isBinaryOperator(operator);
    }

    // Final reduce to clean-up the stack.
    return [stack.reduceRight(function (expr, stackItem) {
      return _this.markLocation(new Shift.BinaryExpression(stackItem.operator.name, stackItem.left, expr), stackItem.startIndex, _this.tokenIndex);
    }, right), false];
  };

  Parser.isPrefixOperator = function (type) {
    switch (type) {
      case TokenType.INC:
      case TokenType.DEC:
      case TokenType.ADD:
      case TokenType.SUB:
      case TokenType.BIT_NOT:
      case TokenType.NOT:
      case TokenType.DELETE:
      case TokenType.VOID:
      case TokenType.TYPEOF:
        return true;
    }
    return false;
  };

  Parser.prototype.parseUnaryExpression = function () {
    if (this.lookahead.type.klass != TokenClass.Punctuator && this.lookahead.type.klass != TokenClass.Keyword) {
      return this.parsePostfixExpression();
    }
    var startTokenIndex = this.tokenIndex;
    var operator = this.lookahead;
    if (!Parser.isPrefixOperator(operator.type)) {
      return this.parsePostfixExpression();
    }
    this.lex();
    var expr = this.parseUnaryExpression()[0];
    switch (operator.type) {
      case TokenType.INC:
      case TokenType.DEC:
        // 11.4.4, 11.4.5;
        if (expr.type === "IdentifierExpression") {
          if (this.strict && isRestrictedWord(expr.identifier.name)) {
            throw this.createError(ErrorMessages.STRICT_LHS_PREFIX);
          }
        }
        break;
      case TokenType.DELETE:
        if (expr.type === "IdentifierExpression" && this.strict) {
          throw this.createError(ErrorMessages.STRICT_DELETE);
        }
        break;
      default:
        break;
    }

    expr = this.markLocation(new Shift.PrefixExpression(operator.value, expr), startTokenIndex);
    return [expr, false];
  };

  Parser.prototype.parsePostfixExpression = function () {
    var startTokenIndex = this.tokenIndex;

    var expr = this.parseLeftHandSideExpressionAllowCall();

    if (this.hasLineTerminatorBeforeNext) {
      return [expr, true];
    }

    var operator = this.lookahead;
    if ((operator.type !== TokenType.INC) && (operator.type !== TokenType.DEC)) {
      return [expr, true];
    }
    this.lex();
    // 11.3.1, 11.3.2;
    if (expr.type === "IdentifierExpression") {
      if (this.strict && isRestrictedWord(expr.identifier.name)) {
        throw this.createError(ErrorMessages.STRICT_LHS_POSTFIX);
      }
    }
    return [this.markLocation(new Shift.PostfixExpression(expr, operator.value), startTokenIndex), false];
  };

  Parser.prototype.parseLeftHandSideExpressionAllowCall = function () {
    var startTokenIndex = this.tokenIndex;
    var previousAllowIn = this.allowIn;
    this.allowIn = true;
    var expr = this.match(TokenType.NEW) ? this.parseNewExpression() : this.parsePrimaryExpression();

    while (true) {
      if (this.match(TokenType.LPAREN)) {
        expr = this.markLocation(new Shift.CallExpression(expr, this.parseArgumentList()), startTokenIndex);
      } else if (this.match(TokenType.LBRACK)) {
        expr = this.markLocation(new Shift.ComputedMemberExpression(expr, this.parseComputedMember()), startTokenIndex);
      } else if (this.match(TokenType.PERIOD)) {
        expr = this.markLocation(new Shift.StaticMemberExpression(expr, this.parseNonComputedMember()), startTokenIndex);
      } else {
        break;
      }
    }

    this.allowIn = previousAllowIn;

    return expr;
  };

  Parser.prototype.parseLeftHandSideExpression = function () {
    var startTokenIndex = this.tokenIndex;

    var expr = this.match(TokenType.NEW) ? this.parseNewExpression() : this.parsePrimaryExpression();

    while (this.match(TokenType.PERIOD) || this.match(TokenType.LBRACK)) {
      expr = this.markLocation(this.match(TokenType.LBRACK) ? new Shift.ComputedMemberExpression(expr, this.parseComputedMember()) : new Shift.StaticMemberExpression(expr, this.parseNonComputedMember()), startTokenIndex);
    }

    return expr;
  };

  Parser.prototype.parseNonComputedMember = function () {
    this.expect(TokenType.PERIOD);
    return this.parseNonComputedProperty();
  };

  Parser.prototype.parseComputedMember = function () {
    this.expect(TokenType.LBRACK);
    var expr = this.parseExpression()[0];
    this.expect(TokenType.RBRACK);
    return expr;
  };

  Parser.prototype.parseNewExpression = function () {
    var startTokenIndex = this.tokenIndex;
    this.expect(TokenType.NEW);
    var callee = this.parseLeftHandSideExpression();
    return this.markLocation(new Shift.NewExpression(callee, this.match(TokenType.LPAREN) ? this.parseArgumentList() : []), startTokenIndex);
  };

  Parser.prototype.parsePrimaryExpression = function () {
    if (this.match(TokenType.LPAREN)) {
      return this.parseGroupExpression();
    }

    var startTokenIndex = this.tokenIndex;

    switch (this.lookahead.type.klass) {
      case TokenClass.Ident:
        return this.markLocation(new Shift.IdentifierExpression(this.parseIdentifier()), startTokenIndex);
      case TokenClass.StringLiteral:
        return this.parseStringLiteral();
      case TokenClass.NumericLiteral:
        return this.parseNumericLiteral();
      case TokenClass.Keyword:
        {
          if (this.match(TokenType.THIS)) {
            this.lex();
            return this.markLocation(new Shift.ThisExpression(), startTokenIndex);
          }
          if (this.match(TokenType.FUNCTION)) {
            return this.markLocation(this.parseFunction(true), startTokenIndex);
          }
          break;
        }
      case TokenClass.BooleanLiteral:
        {
          var token = this.lex();
          return this.markLocation(new Shift.LiteralBooleanExpression(token.type == TokenType.TRUE_LITERAL), startTokenIndex);
        }
      case TokenClass.NullLiteral:
        {
          this.lex();
          return this.markLocation(new Shift.LiteralNullExpression(), startTokenIndex);
        }
      default:
        if (this.match(TokenType.LBRACK)) {
          return this.parseArrayExpression();
        } else if (this.match(TokenType.LBRACE)) {
          return this.parseObjectExpression();
        } else if (this.match(TokenType.DIV) || this.match(TokenType.ASSIGN_DIV)) {
          this.skipComment();
          this.lookahead = this.scanRegExp();
          var token = this.lex();
          try {
            var lastSlash = token.value.lastIndexOf("/");
            RegExp(token.value.slice(1, lastSlash), token.value.slice(lastSlash + 1));
          } catch (unused) {
            throw this.createErrorWithToken(token, ErrorMessages.INVALID_REGULAR_EXPRESSION);
          }
          return this.markLocation(new Shift.LiteralRegExpExpression(token.value), startTokenIndex);
        }
    }

    throw this.createUnexpected(this.lex());
  };

  Parser.prototype.parseNumericLiteral = function () {
    var startTokenIndex = this.tokenIndex;
    if (this.strict && this.lookahead.octal) {
      throw this.createErrorWithToken(this.lookahead, ErrorMessages.STRICT_OCTAL_LITERAL);
    }
    var token2 = this.lex();
    var node = token2._value === 1 / 0 ? new Shift.LiteralInfinityExpression() : new Shift.LiteralNumericExpression(token2._value);
    return this.markLocation(node, startTokenIndex);
  };

  Parser.prototype.parseStringLiteral = function () {
    var startTokenIndex = this.tokenIndex;
    if (this.strict && this.lookahead.octal) {
      throw this.createErrorWithToken(this.lookahead, ErrorMessages.STRICT_OCTAL_LITERAL);
    }
    var token2 = this.lex();
    return this.markLocation(new Shift.LiteralStringExpression(token2._value, token2.slice.text), startTokenIndex);
  };

  Parser.prototype.parseIdentifier = function () {
    var startTokenIndex = this.tokenIndex;
    return this.markLocation(new Shift.Identifier(this.lex().value), startTokenIndex);
  };

  Parser.prototype.parseArgumentList = function () {
    this.expect(TokenType.LPAREN);
    var args = this.parseArguments();
    this.expect(TokenType.RPAREN);
    return args;
  };

  Parser.prototype.parseArguments = function () {
    var result = [];
    while (true) {
      if (this.match(TokenType.RPAREN) || this.eof()) {
        return result;
      }
      var arg = this.parseAssignmentExpression()[0];
      result.push(arg);
      if (!this.eat(TokenType.COMMA)) {
        break;
      }
    }
    return result;
  };

  Parser.prototype.parseNonComputedProperty = function () {
    var startTokenIndex = this.tokenIndex;

    var token = this.lex();

    if (!(token instanceof IdentifierLikeToken)) {
      throw this.createUnexpected(token);
    } else {
      return this.markLocation(new Shift.Identifier(token.value), startTokenIndex);
    }
  };

  Parser.prototype.parseGroupExpression = function () {
    this.expect(TokenType.LPAREN);
    var expr = this.parseExpression()[0];
    this.expect(TokenType.RPAREN);
    return expr;
  };

  Parser.prototype.parseArrayExpression = function () {
    var startTokenIndex = this.tokenIndex;

    this.expect(TokenType.LBRACK);

    var elements = this.parseArrayExpressionElements();

    this.expect(TokenType.RBRACK);

    return this.markLocation(new Shift.ArrayExpression(elements), startTokenIndex);
  };

  Parser.prototype.parseArrayExpressionElements = function () {
    var result = [];
    while (true) {
      if (this.match(TokenType.RBRACK)) {
        return result;
      }
      var el = undefined;

      if (this.match(TokenType.COMMA)) {
        this.lex();
        el = null;
      } else {
        el = this.parseAssignmentExpression()[0];
        if (!this.match(TokenType.RBRACK)) {
          this.expect(TokenType.COMMA);
        }
      }
      result.push(el);
    }
  };

  Parser.prototype.parseObjectExpression = function () {
    var startTokenIndex = this.tokenIndex;

    this.expect(TokenType.LBRACE);

    var propertyMap = Object.create(null);
    var properties = this.parseObjectExpressionItems(propertyMap);

    this.expect(TokenType.RBRACE);

    return this.markLocation(new Shift.ObjectExpression(properties), startTokenIndex);
  };

  Parser.prototype.parseObjectExpressionItems = function (propertyMap) {
    var result = [];
    while (!this.match(TokenType.RBRACE)) {
      result.push(this.parseObjectExpressionItem(propertyMap));
    }
    return result;
  };

  Parser.prototype.parseObjectExpressionItem = function (propertyMap) {
    var property = this.parseObjectProperty();
    var type = property.type;
    var key = "$" + property.name.value;
    var value = {}.hasOwnProperty.call(propertyMap, key) ? propertyMap[key] : 0;

    if ({}.hasOwnProperty.call(propertyMap, key)) {
      if ((value & INIT_MASK) !== 0) {
        if (this.strict && type === "DataProperty") {
          throw this.createError(ErrorMessages.STRICT_DUPLICATE_PROPERTY);
        } else if (type !== "DataProperty") {
          throw this.createError(ErrorMessages.ACCESSOR_DATA_PROPERTY);
        }
      } else {
        if (type === "DataProperty") {
          throw this.createError(ErrorMessages.ACCESSOR_DATA_PROPERTY);
        } else if ((value & GETTER_MASK) !== 0 && type == "Getter" || (value & SETTER_MASK) !== 0 && type == "Setter") {
          throw this.createError(ErrorMessages.ACCESSOR_GET_SET);
        }
      }
    }
    switch (type) {
      case "DataProperty":
        propertyMap[key] = value | INIT_MASK;
        break;
      case "Getter":
        propertyMap[key] = value | GETTER_MASK;
        break;
      case "Setter":
        propertyMap[key] = value | SETTER_MASK;
        break;
    }

    if (!this.match(TokenType.RBRACE)) {
      this.expect(TokenType.COMMA);
    }
    return property;
  };

  Parser.prototype.parseObjectPropertyKey = function () {
    var token = this.lookahead;

    // Note: This function is called only from parseObjectProperty(), where;
    // Eof and Punctuator tokens are already filtered out.

    if (token instanceof StringLiteralToken) {
      return new Shift.PropertyName("string", this.parseStringLiteral().value);
    }
    if (token instanceof NumericLiteralToken) {
      var numLiteral = this.parseNumericLiteral();
      return new Shift.PropertyName("number", "" + (numLiteral.type === "LiteralInfinityExpression" ? 1 / 0 : numLiteral.value));
    }
    if (token instanceof IdentifierLikeToken) {
      return new Shift.PropertyName("identifier", this.parseIdentifier().name);
    }

    throw this.createError(ErrorMessages.INVALID_PROPERTY_NAME);
  };

  Parser.prototype.parseObjectProperty = function () {
    var token = this.lookahead;
    var startTokenIndex = this.tokenIndex;

    if (token.type === TokenType.IDENTIFIER) {
      var key = this.parseObjectPropertyKey();
      var name = token.value;
      if (name.length === 3) {
        // Property Assignment: Getter and Setter.
        if ("get" === name && !this.match(TokenType.COLON)) {
          key = this.parseObjectPropertyKey();
          this.expect(TokenType.LPAREN);
          this.expect(TokenType.RPAREN);
          var _ref15 = this.parseFunctionBody();

          var _ref16 = _toArray(_ref15);

          var body = _ref16[0];
          var isStrict = _ref16[1];
          return this.markLocation(new Shift.Getter(key, body), startTokenIndex);
        } else if ("set" === name && !this.match(TokenType.COLON)) {
          key = this.parseObjectPropertyKey();
          this.expect(TokenType.LPAREN);
          token = this.lookahead;
          if (token.type !== TokenType.IDENTIFIER) {
            this.expect(TokenType.RPAREN);
            throw this.createErrorWithToken(token, ErrorMessages.UNEXPECTED_TOKEN, token.type.name);
          } else {
            var param = this.parseVariableIdentifier();
            this.expect(TokenType.RPAREN);
            var _ref17 = this.parseFunctionBody();

            var _ref18 = _toArray(_ref17);

            var body = _ref18[0];
            var isStrict = _ref18[1];
            if ((this.strict || isStrict) && isRestrictedWord(param.name)) {
              throw this.createError(ErrorMessages.STRICT_PARAM_NAME);
            }
            return this.markLocation(new Shift.Setter(key, param, body), startTokenIndex);
          }
        }
      }

      this.expect(TokenType.COLON);
      var value = this.parseAssignmentExpression()[0];
      return this.markLocation(new Shift.DataProperty(key, value), startTokenIndex);
    }
    if (this.eof() || token.type.klass == TokenClass.Punctuator) {
      throw this.createUnexpected(token);
    } else {
      var key = this.parseObjectPropertyKey();
      this.expect(TokenType.COLON);
      var value = this.parseAssignmentExpression()[0];
      return this.markLocation(new Shift.DataProperty(key, value), startTokenIndex);
    }
  };

  Parser.prototype.parseFunction = function (isExpression) {
    var startTokenIndex = this.tokenIndex;

    this.expect(TokenType.FUNCTION);

    var id = null;
    var message = null;
    var firstRestricted = null;
    if (!isExpression || !this.match(TokenType.LPAREN)) {
      var token = this.lookahead;
      id = this.parseVariableIdentifier();
      if (this.strict) {
        if (isRestrictedWord(id.name)) {
          throw this.createErrorWithToken(token, ErrorMessages.STRICT_FUNCTION_NAME);
        }
      } else {
        if (isRestrictedWord(id.name)) {
          firstRestricted = token;
          message = ErrorMessages.STRICT_FUNCTION_NAME;
        } else if (isStrictModeReservedWordES5(id.name)) {
          firstRestricted = token;
          message = ErrorMessages.STRICT_RESERVED_WORD;
        }
      }
    }
    var info = this.parseParams(firstRestricted);

    if (info.message != null) {
      message = info.message;
    }

    var previousStrict = this.strict;
    var _ref19 = this.parseFunctionBody();

    var _ref20 = _toArray(_ref19);

    var body = _ref20[0];
    var isStrict = _ref20[1];
    if (message != null) {
      if ((this.strict || isStrict) && info.firstRestricted != null) {
        throw this.createErrorWithToken(info.firstRestricted, message);
      }
      if ((this.strict || isStrict) && info.stricted != null) {
        throw this.createErrorWithToken(info.stricted, message);
      }
    }
    this.strict = previousStrict;
    return this.markLocation(new (isExpression ? Shift.FunctionExpression : Shift.FunctionDeclaration)(id, info.params, body), startTokenIndex);
  };

  Parser.prototype.parseParams = function (fr) {
    var info = { params: [] };
    info.firstRestricted = fr;
    this.expect(TokenType.LPAREN);

    if (!this.match(TokenType.RPAREN)) {
      var paramSet = Object.create(null);

      while (!this.eof()) {
        var token = this.lookahead;
        var param = this.parseVariableIdentifier();
        var key = "$" + param.name;
        if (this.strict) {
          if (token instanceof IdentifierLikeToken && isRestrictedWord(param.name)) {
            info.stricted = token;
            info.message = ErrorMessages.STRICT_PARAM_NAME;
          }
          if ({}.hasOwnProperty.call(paramSet, key)) {
            info.stricted = token;
            info.message = ErrorMessages.STRICT_PARAM_DUPE;
          }
        } else if (info.firstRestricted == null) {
          if (token instanceof IdentifierLikeToken && isRestrictedWord(param.name)) {
            info.firstRestricted = token;
            info.message = ErrorMessages.STRICT_PARAM_NAME;
          } else if (STRICT_MODE_RESERVED_WORD.indexOf(param.name) !== -1) {
            info.firstRestricted = token;
            info.message = ErrorMessages.STRICT_RESERVED_WORD;
          } else if ({}.hasOwnProperty.call(paramSet, key)) {
            info.firstRestricted = token;
            info.message = ErrorMessages.STRICT_PARAM_DUPE;
          }
        }
        info.params.push(param);
        paramSet[key] = true;
        if (this.match(TokenType.RPAREN)) {
          break;
        }
        this.expect(TokenType.COMMA);
      }
    }

    this.expect(TokenType.RPAREN);
    return info;
  };

  return Parser;
})(Tokenizer);

exports.Parser = Parser;
//# sourceMappingURL=data:application/json;base64,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RyxDQUFDLEdBQUcsSUFBSSxDQUFDO0FBQ3JCLFlBQUksSUFBSSxDQUFDLEtBQUssQ0FBQyxTQUFTLENBQUMsTUFBTSxDQUFDLEVBQUU7QUFDaEMsZ0JBQU07U0FDUDtBQUNELFlBQUksQ0FBQyxNQUFNLENBQUMsU0FBUyxDQUFDLEtBQUssQ0FBQyxDQUFDO09BQzlCO0tBQ0Y7O0FBRUQsUUFBSSxDQUFDLE1BQU0sQ0FBQyxTQUFTLENBQUMsTUFBTSxDQUFDLENBQUM7QUFDOUIsV0FBTyxJQUFJLENBQUM7R0FDYjs7U0EzMENVLE1BQU07R0FBUyxTQUFTOztRQUF4QixNQUFNLEdBQU4sTUFBTSIsImZpbGUiOiJzcmMvcGFyc2VyLmpzIiwic291cmNlc0NvbnRlbnQiOlsiLyoqXG4gKiBDb3B5cmlnaHQgMjAxNCBTaGFwZSBTZWN1cml0eSwgSW5jLlxuICpcbiAqIExpY2Vuc2VkIHVuZGVyIHRoZSBBcGFjaGUgTGljZW5zZSwgVmVyc2lvbiAyLjAgKHRoZSBcIkxpY2Vuc2VcIilcbiAqIHlvdSBtYXkgbm90IHVzZSB0aGlzIGZpbGUgZXhjZXB0IGluIGNvbXBsaWFuY2Ugd2l0aCB0aGUgTGljZW5zZS5cbiAqIFlvdSBtYXkgb2J0YWluIGEgY29weSBvZiB0aGUgTGljZW5zZSBhdFxuICpcbiAqICAgICBodHRwOi8vd3d3LmFwYWNoZS5vcmcvbGljZW5zZXMvTElDRU5TRS0yLjBcbiAqXG4gKiBVbmxlc3MgcmVxdWlyZWQgYnkgYXBwbGljYWJsZSBsYXcgb3IgYWdyZWVkIHRvIGluIHdyaXRpbmcsIHNvZnR3YXJlXG4gKiBkaXN0cmlidXRlZCB1bmRlciB0aGUgTGljZW5zZSBpcyBkaXN0cmlidXRlZCBvbiBhbiBcIkFTIElTXCIgQkFTSVMsXG4gKiBXSVRIT1VUIFdBUlJBTlRJRVMgT1IgQ09ORElUSU9OUyBPRiBBTlkgS0lORCwgZWl0aGVyIGV4cHJlc3Mgb3IgaW1wbGllZC5cbiAqIFNlZSB0aGUgTGljZW5zZSBmb3IgdGhlIHNwZWNpZmljIGxhbmd1YWdlIGdvdmVybmluZyBwZXJtaXNzaW9ucyBhbmRcbiAqIGxpbWl0YXRpb25zIHVuZGVyIHRoZSBMaWNlbnNlLlxuICovXG5cbmltcG9ydCAqIGFzIFNoaWZ0IGZyb20gXCJzaGlmdC1hc3RcIjtcblxuaW1wb3J0IHtpc1Jlc3RyaWN0ZWRXb3JkLCBpc1N0cmljdE1vZGVSZXNlcnZlZFdvcmRFUzV9IGZyb20gXCIuL3V0aWxzXCI7XG5cbmltcG9ydCB7RXJyb3JNZXNzYWdlc30gZnJvbSBcIi4vZXJyb3JzXCI7XG5cbmltcG9ydCBUb2tlbml6ZXIsIHtcbiAgICBUb2tlbkNsYXNzLFxuICAgIFRva2VuVHlwZSxcbiAgICBJZGVudGlmaWVyVG9rZW4sXG4gICAgSWRlbnRpZmllckxpa2VUb2tlbixcbiAgICBOdW1lcmljTGl0ZXJhbFRva2VuLFxuICAgIFN0cmluZ0xpdGVyYWxUb2tlbn0gZnJvbSBcIi4vdG9rZW5pemVyXCI7XG5cbmNvbnN0IElOSVRfTUFTSyA9IDE7XG5jb25zdCBHRVRURVJfTUFTSyA9IDI7XG5jb25zdCBTRVRURVJfTUFTSyA9IDQ7XG5cbmNvbnN0IFNUUklDVF9NT0RFX1JFU0VSVkVEX1dPUkQgPSBbXG4gIFwiaW1wbGVtZW50c1wiLCBcImludGVyZmFjZVwiLCBcInBhY2thZ2VcIiwgXCJwcml2YXRlXCIsIFwicHJvdGVjdGVkXCIsIFwicHVibGljXCIsIFwic3RhdGljXCIsIFwieWllbGRcIiwgXCJsZXRcIl07XG5cbmNvbnN0IFByZWNlZGVuY2UgPSB7XG4gIFNlcXVlbmNlOiAwLFxuICBZaWVsZDogMSxcbiAgQXNzaWdubWVudDogMSxcbiAgQ29uZGl0aW9uYWw6IDIsXG4gIEFycm93RnVuY3Rpb246IDIsXG4gIExvZ2ljYWxPUjogMyxcbiAgTG9naWNhbEFORDogNCxcbiAgQml0d2lzZU9SOiA1LFxuICBCaXR3aXNlWE9SOiA2LFxuICBCaXR3aXNlQU5EOiA3LFxuICBFcXVhbGl0eTogOCxcbiAgUmVsYXRpb25hbDogOSxcbiAgQml0d2lzZVNISUZUOiAxMCxcbiAgQWRkaXRpdmU6IDExLFxuICBNdWx0aXBsaWNhdGl2ZTogMTIsXG4gIFVuYXJ5OiAxMyxcbiAgUG9zdGZpeDogMTQsXG4gIENhbGw6IDE1LFxuICBOZXc6IDE2LFxuICBUYWdnZWRUZW1wbGF0ZTogMTcsXG4gIE1lbWJlcjogMTgsXG4gIFByaW1hcnk6IDE5XG59O1xuXG5jb25zdCBCaW5hcnlQcmVjZWRlbmNlID0ge1xuICBcInx8XCI6IFByZWNlZGVuY2UuTG9naWNhbE9SLFxuICBcIiYmXCI6IFByZWNlZGVuY2UuTG9naWNhbEFORCxcbiAgXCJ8XCI6IFByZWNlZGVuY2UuQml0d2lzZU9SLFxuICBcIl5cIjogUHJlY2VkZW5jZS5CaXR3aXNlWE9SLFxuICBcIiZcIjogUHJlY2VkZW5jZS5CaXR3aXNlQU5ELFxuICBcIj09XCI6IFByZWNlZGVuY2UuRXF1YWxpdHksXG4gIFwiIT1cIjogUHJlY2VkZW5jZS5FcXVhbGl0eSxcbiAgXCI9PT1cIjogUHJlY2VkZW5jZS5FcXVhbGl0eSxcbiAgXCIhPT1cIjogUHJlY2VkZW5jZS5FcXVhbGl0eSxcbiAgXCI8XCI6IFByZWNlZGVuY2UuUmVsYXRpb25hbCxcbiAgXCI+XCI6IFByZWNlZGVuY2UuUmVsYXRpb25hbCxcbiAgXCI8PVwiOiBQcmVjZWRlbmNlLlJlbGF0aW9uYWwsXG4gIFwiPj1cIjogUHJlY2VkZW5jZS5SZWxhdGlvbmFsLFxuICBcImluXCI6IFByZWNlZGVuY2UuUmVsYXRpb25hbCxcbiAgXCJpbnN0YW5jZW9mXCI6IFByZWNlZGVuY2UuUmVsYXRpb25hbCxcbiAgXCI8PFwiOiBQcmVjZWRlbmNlLkJpdHdpc2VTSElGVCxcbiAgXCI+PlwiOiBQcmVjZWRlbmNlLkJpdHdpc2VTSElGVCxcbiAgXCI+Pj5cIjogUHJlY2VkZW5jZS5CaXR3aXNlU0hJRlQsXG4gIFwiK1wiOiBQcmVjZWRlbmNlLkFkZGl0aXZlLFxuICBcIi1cIjogUHJlY2VkZW5jZS5BZGRpdGl2ZSxcbiAgXCIqXCI6IFByZWNlZGVuY2UuTXVsdGlwbGljYXRpdmUsXG4gIFwiJVwiOiBQcmVjZWRlbmNlLk11bHRpcGxpY2F0aXZlLFxuICBcIi9cIjogUHJlY2VkZW5jZS5NdWx0aXBsaWNhdGl2ZSxcbn07XG5cbmV4cG9ydCBjbGFzcyBQYXJzZXIgZXh0ZW5kcyBUb2tlbml6ZXIge1xuICBjb25zdHJ1Y3Rvcihzb3VyY2UpIHtcbiAgICBzdXBlcihzb3VyY2UpO1xuICAgIHRoaXMubGFiZWxTZXQgPSBPYmplY3QuY3JlYXRlKG51bGwpO1xuICAgIHRoaXMuYWxsb3dJbiA9IHRydWU7XG4gICAgdGhpcy5pbkl0ZXJhdGlvbiA9IGZhbHNlO1xuICAgIHRoaXMuaW5Td2l0Y2ggPSBmYWxzZTtcbiAgICB0aGlzLmluRnVuY3Rpb25Cb2R5ID0gZmFsc2U7XG4gIH1cblxuICBlYXQodG9rZW5UeXBlKSB7XG4gICAgaWYgKHRoaXMubG9va2FoZWFkLnR5cGUgPT09IHRva2VuVHlwZSkge1xuICAgICAgcmV0dXJuIHRoaXMubGV4KCk7XG4gICAgfVxuICB9XG5cbiAgZXhwZWN0KHRva2VuVHlwZSkge1xuICAgIGlmICh0aGlzLmxvb2thaGVhZC50eXBlID09PSB0b2tlblR5cGUpIHtcbiAgICAgIHJldHVybiB0aGlzLmxleCgpO1xuICAgIH1cbiAgICB0aHJvdyB0aGlzLmNyZWF0ZVVuZXhwZWN0ZWQodGhpcy5sb29rYWhlYWQpO1xuICB9XG5cbiAgbWF0Y2goc3ViVHlwZSkge1xuICAgIHJldHVybiB0aGlzLmxvb2thaGVhZC50eXBlID09PSBzdWJUeXBlO1xuICB9XG5cbiAgY29uc3VtZVNlbWljb2xvbigpIHtcbiAgICAvLyBDYXRjaCB0aGUgdmVyeSBjb21tb24gY2FzZSBmaXJzdDogaW1tZWRpYXRlbHkgYSBzZW1pY29sb24gKFUrMDAzQikuXG4gICAgaWYgKHRoaXMuaW5kZXggPCB0aGlzLnNvdXJjZS5sZW5ndGggJiYgdGhpcy5zb3VyY2UuY2hhckF0KHRoaXMuaW5kZXgpID09IFwiO1wiKSB7XG4gICAgICB0aGlzLmxleCgpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIHRoaXMuaW5kZXggPSB0aGlzLmxvb2thaGVhZC5zbGljZS5zdGFydDtcbiAgICBpZiAodGhpcy5oYXNMaW5lVGVybWluYXRvckJlZm9yZU5leHQpIHtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBpZiAodGhpcy5tYXRjaChUb2tlblR5cGUuU0VNSUNPTE9OKSkge1xuICAgICAgdGhpcy5sZXgoKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBpZiAoIXRoaXMuZW9mKCkgJiYgIXRoaXMubWF0Y2goVG9rZW5UeXBlLlJCUkFDRSkpIHtcbiAgICAgIHRocm93IHRoaXMuY3JlYXRlVW5leHBlY3RlZCh0aGlzLmxvb2thaGVhZCk7XG4gICAgfVxuICB9XG5cbiAgLy8gdGhpcyBpcyBhIG5vLW9wLCByZXNlcnZlZCBmb3IgZnV0dXJlIHVzZVxuICBtYXJrTG9jYXRpb24obm9kZSwgc3RhcnRUb2tlbkluZGV4LCBlbmRUb2tlbkluZGV4ID0gdGhpcy50b2tlbkluZGV4KSB7XG4gICAgLy8gVE9ETzogbWFyayB0aGUgc291cmNlIGxvY2F0aW9ucy5cbiAgICByZXR1cm4gbm9kZTtcbiAgfVxuXG4gIHBhcnNlU2NyaXB0KCkge1xuICAgIHZhciBbYm9keSwgaXNTdHJpY3RdID0gdGhpcy5wYXJzZUJvZHkodHJ1ZSk7XG4gICAgcmV0dXJuIG5ldyBTaGlmdC5TY3JpcHQodGhpcy5tYXJrTG9jYXRpb24oYm9keSwgMCkpO1xuICB9XG5cbiAgcGFyc2VGdW5jdGlvbkJvZHkoKSB7XG4gICAgbGV0IHByZXZpb3VzU3RyaWN0ID0gdGhpcy5zdHJpY3Q7XG4gICAgbGV0IHN0YXJ0VG9rZW5JbmRleCA9IHRoaXMudG9rZW5JbmRleDtcblxuICAgIGxldCBvbGRMYWJlbFNldCA9IHRoaXMubGFiZWxTZXQ7XG4gICAgbGV0IG9sZEluSXRlcmF0aW9uID0gdGhpcy5pbkl0ZXJhdGlvbjtcbiAgICBsZXQgb2xkSW5Td2l0Y2ggPSB0aGlzLmluU3dpdGNoO1xuICAgIGxldCBvbGRJbkZ1bmN0aW9uQm9keSA9IHRoaXMuaW5GdW5jdGlvbkJvZHk7XG5cbiAgICB0aGlzLmxhYmVsU2V0ID0gT2JqZWN0LmNyZWF0ZShudWxsKTtcbiAgICB0aGlzLmluSXRlcmF0aW9uID0gZmFsc2U7XG4gICAgdGhpcy5pblN3aXRjaCA9IGZhbHNlO1xuICAgIHRoaXMuaW5GdW5jdGlvbkJvZHkgPSB0cnVlO1xuXG4gICAgdGhpcy5leHBlY3QoVG9rZW5UeXBlLkxCUkFDRSk7XG4gICAgbGV0IFtib2R5LCBpc1N0cmljdF0gPSB0aGlzLnBhcnNlQm9keSgpO1xuICAgIHRoaXMuZXhwZWN0KFRva2VuVHlwZS5SQlJBQ0UpO1xuXG4gICAgYm9keSA9IHRoaXMubWFya0xvY2F0aW9uKGJvZHksIHN0YXJ0VG9rZW5JbmRleCk7XG5cbiAgICB0aGlzLmxhYmVsU2V0ID0gb2xkTGFiZWxTZXQ7XG4gICAgdGhpcy5pbkl0ZXJhdGlvbiA9IG9sZEluSXRlcmF0aW9uO1xuICAgIHRoaXMuaW5Td2l0Y2ggPSBvbGRJblN3aXRjaDtcbiAgICB0aGlzLmluRnVuY3Rpb25Cb2R5ID0gb2xkSW5GdW5jdGlvbkJvZHk7XG4gICAgdGhpcy5zdHJpY3QgPSBwcmV2aW91c1N0cmljdDtcbiAgICByZXR1cm4gW2JvZHksIGlzU3RyaWN0XTtcbiAgfVxuXG4gIHBhcnNlQm9keShhY2NlcHRFT0YgPSBmYWxzZSkge1xuICAgIGxldCBkaXJlY3RpdmVzID0gW107XG4gICAgbGV0IHN0YXRlbWVudHMgPSBbXTtcbiAgICBsZXQgcGFyc2luZ0RpcmVjdGl2ZXMgPSB0cnVlO1xuICAgIGxldCBpc1N0cmljdCA9IHRoaXMuc3RyaWN0O1xuICAgIGxldCBmaXJzdFJlc3RyaWN0ZWQgPSBudWxsO1xuICAgIHdoaWxlICh0cnVlKSB7XG4gICAgICBpZiAoYWNjZXB0RU9GKSB7XG4gICAgICAgIGlmICh0aGlzLmVvZigpKSB7XG4gICAgICAgICAgYnJlYWs7XG4gICAgICAgIH1cbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGlmICh0aGlzLm1hdGNoKFRva2VuVHlwZS5SQlJBQ0UpKSB7XG4gICAgICAgICAgYnJlYWs7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICAgIGxldCB0b2tlbiA9IHRoaXMubG9va2FoZWFkO1xuICAgICAgbGV0IHRleHQgPSB0b2tlbi5zbGljZS50ZXh0O1xuICAgICAgbGV0IGlzU3RyaW5nTGl0ZXJhbCA9IHRva2VuIGluc3RhbmNlb2YgU3RyaW5nTGl0ZXJhbFRva2VuO1xuICAgICAgbGV0IHN0bXQgPSB0aGlzLnBhcnNlU3RhdGVtZW50KCk7XG4gICAgICBpZiAocGFyc2luZ0RpcmVjdGl2ZXMpIHtcbiAgICAgICAgaWYgKGlzU3RyaW5nTGl0ZXJhbCAmJiBzdG10LnR5cGUgPT09IFwiRXhwcmVzc2lvblN0YXRlbWVudFwiICYmXG4gICAgICAgICAgICBzdG10LmV4cHJlc3Npb24udHlwZSA9PT0gXCJMaXRlcmFsU3RyaW5nRXhwcmVzc2lvblwiKSB7XG4gICAgICAgICAgaWYgKHRleHQgPT09IFwiXFxcInVzZSBzdHJpY3RcXFwiXCIgfHwgdGV4dCA9PT0gXCIndXNlIHN0cmljdCdcIikge1xuICAgICAgICAgICAgZGlyZWN0aXZlcy5wdXNoKG5ldyBTaGlmdC5Vc2VTdHJpY3REaXJlY3RpdmUpO1xuICAgICAgICAgICAgaXNTdHJpY3QgPSB0cnVlO1xuICAgICAgICAgICAgdGhpcy5zdHJpY3QgPSB0cnVlO1xuICAgICAgICAgICAgaWYgKGZpcnN0UmVzdHJpY3RlZCAhPSBudWxsKSB7XG4gICAgICAgICAgICAgIHRocm93IHRoaXMuY3JlYXRlRXJyb3JXaXRoVG9rZW4oZmlyc3RSZXN0cmljdGVkLCBFcnJvck1lc3NhZ2VzLlNUUklDVF9PQ1RBTF9MSVRFUkFMKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgZGlyZWN0aXZlcy5wdXNoKG5ldyBTaGlmdC5Vbmtub3duRGlyZWN0aXZlKHN0bXQuZXhwcmVzc2lvbi52YWx1ZSkpO1xuICAgICAgICAgICAgaWYgKGZpcnN0UmVzdHJpY3RlZCA9PSBudWxsICYmIHRva2VuLm9jdGFsKSB7XG4gICAgICAgICAgICAgIGZpcnN0UmVzdHJpY3RlZCA9IHRva2VuO1xuICAgICAgICAgICAgfVxuICAgICAgICAgIH1cbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICBwYXJzaW5nRGlyZWN0aXZlcyA9IGZhbHNlO1xuICAgICAgICAgIHN0YXRlbWVudHMucHVzaChzdG10KTtcbiAgICAgICAgfVxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgc3RhdGVtZW50cy5wdXNoKHN0bXQpO1xuICAgICAgfVxuICAgIH1cblxuICAgIHJldHVybiBbbmV3IFNoaWZ0LkZ1bmN0aW9uQm9keShkaXJlY3RpdmVzLCBzdGF0ZW1lbnRzKSwgaXNTdHJpY3RdO1xuICB9XG5cblxuICBwYXJzZVN0YXRlbWVudCgpIHtcbiAgICBsZXQgc3RhcnRUb2tlbkluZGV4ID0gdGhpcy50b2tlbkluZGV4O1xuICAgIGlmICh0aGlzLmVvZigpKSB7XG4gICAgICB0aHJvdyB0aGlzLmNyZWF0ZVVuZXhwZWN0ZWQodGhpcy5sb29rYWhlYWQpO1xuICAgIH1cbiAgICBzd2l0Y2ggKHRoaXMubG9va2FoZWFkLnR5cGUpIHtcbiAgICAgIGNhc2UgVG9rZW5UeXBlLlNFTUlDT0xPTjpcbiAgICAgICAgcmV0dXJuIHRoaXMubWFya0xvY2F0aW9uKHRoaXMucGFyc2VFbXB0eVN0YXRlbWVudCgpLCBzdGFydFRva2VuSW5kZXgpO1xuICAgICAgY2FzZSBUb2tlblR5cGUuTEJSQUNFOlxuICAgICAgICByZXR1cm4gdGhpcy5tYXJrTG9jYXRpb24odGhpcy5wYXJzZUJsb2NrU3RhdGVtZW50KCksIHN0YXJ0VG9rZW5JbmRleCk7XG4gICAgICBjYXNlIFRva2VuVHlwZS5MUEFSRU46XG4gICAgICAgIHJldHVybiB0aGlzLm1hcmtMb2NhdGlvbih0aGlzLnBhcnNlRXhwcmVzc2lvblN0YXRlbWVudCgpLCBzdGFydFRva2VuSW5kZXgpO1xuICAgICAgY2FzZSBUb2tlblR5cGUuQlJFQUs6XG4gICAgICAgIHJldHVybiB0aGlzLm1hcmtMb2NhdGlvbih0aGlzLnBhcnNlQnJlYWtTdGF0ZW1lbnQoKSwgc3RhcnRUb2tlbkluZGV4KTtcbiAgICAgIGNhc2UgVG9rZW5UeXBlLkNPTlRJTlVFOlxuICAgICAgICByZXR1cm4gdGhpcy5tYXJrTG9jYXRpb24odGhpcy5wYXJzZUNvbnRpbnVlU3RhdGVtZW50KCksIHN0YXJ0VG9rZW5JbmRleCk7XG4gICAgICBjYXNlIFRva2VuVHlwZS5ERUJVR0dFUjpcbiAgICAgICAgcmV0dXJuIHRoaXMubWFya0xvY2F0aW9uKHRoaXMucGFyc2VEZWJ1Z2dlclN0YXRlbWVudCgpLCBzdGFydFRva2VuSW5kZXgpO1xuICAgICAgY2FzZSBUb2tlblR5cGUuRE86XG4gICAgICAgIHJldHVybiB0aGlzLm1hcmtMb2NhdGlvbih0aGlzLnBhcnNlRG9XaGlsZVN0YXRlbWVudCgpLCBzdGFydFRva2VuSW5kZXgpO1xuICAgICAgY2FzZSBUb2tlblR5cGUuRk9SOlxuICAgICAgICByZXR1cm4gdGhpcy5tYXJrTG9jYXRpb24odGhpcy5wYXJzZUZvclN0YXRlbWVudCgpLCBzdGFydFRva2VuSW5kZXgpO1xuICAgICAgY2FzZSBUb2tlblR5cGUuRlVOQ1RJT046XG4gICAgICAgIHJldHVybiB0aGlzLm1hcmtMb2NhdGlvbih0aGlzLnBhcnNlRnVuY3Rpb24oZmFsc2UpLCBzdGFydFRva2VuSW5kZXgpO1xuICAgICAgY2FzZSBUb2tlblR5cGUuSUY6XG4gICAgICAgIHJldHVybiB0aGlzLm1hcmtMb2NhdGlvbih0aGlzLnBhcnNlSWZTdGF0ZW1lbnQoKSwgc3RhcnRUb2tlbkluZGV4KTtcbiAgICAgIGNhc2UgVG9rZW5UeXBlLlJFVFVSTjpcbiAgICAgICAgcmV0dXJuIHRoaXMubWFya0xvY2F0aW9uKHRoaXMucGFyc2VSZXR1cm5TdGF0ZW1lbnQoKSwgc3RhcnRUb2tlbkluZGV4KTtcbiAgICAgIGNhc2UgVG9rZW5UeXBlLlNXSVRDSDpcbiAgICAgICAgcmV0dXJuIHRoaXMubWFya0xvY2F0aW9uKHRoaXMucGFyc2VTd2l0Y2hTdGF0ZW1lbnQoKSwgc3RhcnRUb2tlbkluZGV4KTtcbiAgICAgIGNhc2UgVG9rZW5UeXBlLlRIUk9XOlxuICAgICAgICByZXR1cm4gdGhpcy5tYXJrTG9jYXRpb24odGhpcy5wYXJzZVRocm93U3RhdGVtZW50KCksIHN0YXJ0VG9rZW5JbmRleCk7XG4gICAgICBjYXNlIFRva2VuVHlwZS5UUlk6XG4gICAgICAgIHJldHVybiB0aGlzLm1hcmtMb2NhdGlvbih0aGlzLnBhcnNlVHJ5U3RhdGVtZW50KCksIHN0YXJ0VG9rZW5JbmRleCk7XG4gICAgICBjYXNlIFRva2VuVHlwZS5WQVI6XG4gICAgICBjYXNlIFRva2VuVHlwZS5MRVQ6XG4gICAgICBjYXNlIFRva2VuVHlwZS5DT05TVDpcbiAgICAgICAgcmV0dXJuIHRoaXMubWFya0xvY2F0aW9uKHRoaXMucGFyc2VWYXJpYWJsZURlY2xhcmF0aW9uU3RhdGVtZW50KCksIHN0YXJ0VG9rZW5JbmRleCk7XG4gICAgICBjYXNlIFRva2VuVHlwZS5XSElMRTpcbiAgICAgICAgcmV0dXJuIHRoaXMubWFya0xvY2F0aW9uKHRoaXMucGFyc2VXaGlsZVN0YXRlbWVudCgpLCBzdGFydFRva2VuSW5kZXgpO1xuICAgICAgY2FzZSBUb2tlblR5cGUuV0lUSDpcbiAgICAgICAgcmV0dXJuIHRoaXMubWFya0xvY2F0aW9uKHRoaXMucGFyc2VXaXRoU3RhdGVtZW50KCksIHN0YXJ0VG9rZW5JbmRleCk7XG4gICAgICBkZWZhdWx0OlxuICAgICAge1xuICAgICAgICBsZXQgZXhwciA9IHRoaXMucGFyc2VFeHByZXNzaW9uKClbMF07XG5cbiAgICAgICAgLy8gMTIuMTIgTGFiZWxsZWQgU3RhdGVtZW50cztcbiAgICAgICAgaWYgKGV4cHIudHlwZSA9PT0gXCJJZGVudGlmaWVyRXhwcmVzc2lvblwiICYmIHRoaXMubWF0Y2goVG9rZW5UeXBlLkNPTE9OKSkge1xuICAgICAgICAgIHRoaXMubGV4KCk7XG4gICAgICAgICAgbGV0IGtleSA9IFwiJFwiICsgZXhwci5pZGVudGlmaWVyLm5hbWU7XG4gICAgICAgICAgaWYgKHt9Lmhhc093blByb3BlcnR5LmNhbGwodGhpcy5sYWJlbFNldCwga2V5KSkge1xuICAgICAgICAgICAgdGhyb3cgdGhpcy5jcmVhdGVFcnJvcihFcnJvck1lc3NhZ2VzLkxBQkVMX1JFREVDTEFSQVRJT04sIGV4cHIuaWRlbnRpZmllci5uYW1lKTtcbiAgICAgICAgICB9XG5cbiAgICAgICAgICB0aGlzLmxhYmVsU2V0W2tleV0gPSB0cnVlO1xuICAgICAgICAgIGxldCBsYWJlbGVkQm9keSA9IHRoaXMucGFyc2VTdGF0ZW1lbnQoKTtcbiAgICAgICAgICBkZWxldGUgdGhpcy5sYWJlbFNldFtrZXldO1xuICAgICAgICAgIHJldHVybiB0aGlzLm1hcmtMb2NhdGlvbihuZXcgU2hpZnQuTGFiZWxlZFN0YXRlbWVudChleHByLmlkZW50aWZpZXIsIGxhYmVsZWRCb2R5KSwgc3RhcnRUb2tlbkluZGV4KTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICB0aGlzLmNvbnN1bWVTZW1pY29sb24oKTtcbiAgICAgICAgICByZXR1cm4gdGhpcy5tYXJrTG9jYXRpb24obmV3IFNoaWZ0LkV4cHJlc3Npb25TdGF0ZW1lbnQoZXhwciksIHN0YXJ0VG9rZW5JbmRleCk7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG5cbiAgfVxuXG4gIHBhcnNlVmFyaWFibGVJZGVudGlmaWVyKCkge1xuICAgIGxldCBzdGFydFRva2VuSW5kZXggPSB0aGlzLnRva2VuSW5kZXg7XG5cbiAgICBsZXQgdG9rZW4gPSB0aGlzLmxleCgpO1xuICAgIGlmICghKHRva2VuIGluc3RhbmNlb2YgSWRlbnRpZmllclRva2VuKSkge1xuICAgICAgdGhyb3cgdGhpcy5jcmVhdGVVbmV4cGVjdGVkKHRva2VuKTtcbiAgICB9XG5cbiAgICByZXR1cm4gdGhpcy5tYXJrTG9jYXRpb24obmV3IFNoaWZ0LklkZW50aWZpZXIodG9rZW4udmFsdWUpLCBzdGFydFRva2VuSW5kZXgpO1xuICB9XG5cbiAgcGFyc2VFbXB0eVN0YXRlbWVudCgpIHtcbiAgICB0aGlzLmV4cGVjdChUb2tlblR5cGUuU0VNSUNPTE9OKTtcbiAgICByZXR1cm4gbmV3IFNoaWZ0LkVtcHR5U3RhdGVtZW50O1xuICB9XG5cbiAgcGFyc2VCbG9ja1N0YXRlbWVudCgpIHtcbiAgICByZXR1cm4gbmV3IFNoaWZ0LkJsb2NrU3RhdGVtZW50KHRoaXMucGFyc2VCbG9jaygpKTtcbiAgfVxuXG4gIHBhcnNlRXhwcmVzc2lvblN0YXRlbWVudCgpIHtcbiAgICBsZXQgZXhwciA9IHRoaXMucGFyc2VFeHByZXNzaW9uKClbMF07XG4gICAgdGhpcy5jb25zdW1lU2VtaWNvbG9uKCk7XG4gICAgcmV0dXJuIG5ldyBTaGlmdC5FeHByZXNzaW9uU3RhdGVtZW50KGV4cHIpO1xuICB9XG5cbiAgcGFyc2VCcmVha1N0YXRlbWVudCgpIHtcbiAgICBsZXQgdG9rZW4gPSB0aGlzLmxvb2thaGVhZDtcbiAgICB0aGlzLmV4cGVjdChUb2tlblR5cGUuQlJFQUspO1xuXG4gICAgLy8gQ2F0Y2ggdGhlIHZlcnkgY29tbW9uIGNhc2UgZmlyc3Q6IGltbWVkaWF0ZWx5IGEgc2VtaWNvbG9uIChVKzAwM0IpLlxuICAgIGlmICh0aGlzLmxvb2thaGVhZC50eXBlID09IFRva2VuVHlwZS5TRU1JQ09MT04pIHtcbiAgICAgIHRoaXMubGV4KCk7XG5cbiAgICAgIGlmICghKHRoaXMuaW5JdGVyYXRpb24gfHwgdGhpcy5pblN3aXRjaCkpIHtcbiAgICAgICAgdGhyb3cgdGhpcy5jcmVhdGVFcnJvcldpdGhUb2tlbih0b2tlbiwgRXJyb3JNZXNzYWdlcy5JTExFR0FMX0JSRUFLKTtcbiAgICAgIH1cblxuICAgICAgcmV0dXJuIG5ldyBTaGlmdC5CcmVha1N0YXRlbWVudChudWxsKTtcbiAgICB9XG5cbiAgICBpZiAodGhpcy5oYXNMaW5lVGVybWluYXRvckJlZm9yZU5leHQpIHtcbiAgICAgIGlmICghKHRoaXMuaW5JdGVyYXRpb24gfHwgdGhpcy5pblN3aXRjaCkpIHtcbiAgICAgICAgdGhyb3cgdGhpcy5jcmVhdGVFcnJvcldpdGhUb2tlbih0b2tlbiwgRXJyb3JNZXNzYWdlcy5JTExFR0FMX0JSRUFLKTtcbiAgICAgIH1cblxuICAgICAgcmV0dXJuIG5ldyBTaGlmdC5CcmVha1N0YXRlbWVudChudWxsKTtcbiAgICB9XG5cbiAgICBsZXQgbGFiZWwgPSBudWxsO1xuICAgIGlmICh0aGlzLmxvb2thaGVhZC50eXBlID09IFRva2VuVHlwZS5JREVOVElGSUVSKSB7XG4gICAgICBsYWJlbCA9IHRoaXMucGFyc2VWYXJpYWJsZUlkZW50aWZpZXIoKTtcblxuICAgICAgbGV0IGtleSA9IFwiJFwiICsgbGFiZWwubmFtZTtcbiAgICAgIGlmICghe30uaGFzT3duUHJvcGVydHkuY2FsbCh0aGlzLmxhYmVsU2V0LCBrZXkpKSB7XG4gICAgICAgIHRocm93IHRoaXMuY3JlYXRlRXJyb3IoRXJyb3JNZXNzYWdlcy5VTktOT1dOX0xBQkVMLCBsYWJlbC5uYW1lKTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICB0aGlzLmNvbnN1bWVTZW1pY29sb24oKTtcblxuICAgIGlmIChsYWJlbCA9PSBudWxsICYmICEodGhpcy5pbkl0ZXJhdGlvbiB8fCB0aGlzLmluU3dpdGNoKSkge1xuICAgICAgdGhyb3cgdGhpcy5jcmVhdGVFcnJvcldpdGhUb2tlbih0b2tlbiwgRXJyb3JNZXNzYWdlcy5JTExFR0FMX0JSRUFLKTtcbiAgICB9XG5cbiAgICByZXR1cm4gbmV3IFNoaWZ0LkJyZWFrU3RhdGVtZW50KGxhYmVsKTtcbiAgfVxuXG4gIHBhcnNlQ29udGludWVTdGF0ZW1lbnQoKSB7XG4gICAgbGV0IHRva2VuID0gdGhpcy5sb29rYWhlYWQ7XG4gICAgdGhpcy5leHBlY3QoVG9rZW5UeXBlLkNPTlRJTlVFKTtcblxuICAgIC8vIENhdGNoIHRoZSB2ZXJ5IGNvbW1vbiBjYXNlIGZpcnN0OiBpbW1lZGlhdGVseSBhIHNlbWljb2xvbiAoVSswMDNCKS5cbiAgICBpZiAodGhpcy5sb29rYWhlYWQudHlwZSA9PSBUb2tlblR5cGUuU0VNSUNPTE9OKSB7XG4gICAgICB0aGlzLmxleCgpO1xuICAgICAgaWYgKCF0aGlzLmluSXRlcmF0aW9uKSB7XG4gICAgICAgIHRocm93IHRoaXMuY3JlYXRlRXJyb3JXaXRoVG9rZW4odG9rZW4sIEVycm9yTWVzc2FnZXMuSUxMRUdBTF9DT05USU5VRSk7XG4gICAgICB9XG5cbiAgICAgIHJldHVybiBuZXcgU2hpZnQuQ29udGludWVTdGF0ZW1lbnQobnVsbCk7XG4gICAgfVxuXG4gICAgaWYgKHRoaXMuaGFzTGluZVRlcm1pbmF0b3JCZWZvcmVOZXh0KSB7XG4gICAgICBpZiAoIXRoaXMuaW5JdGVyYXRpb24pIHtcbiAgICAgICAgdGhyb3cgdGhpcy5jcmVhdGVFcnJvcldpdGhUb2tlbih0b2tlbiwgRXJyb3JNZXNzYWdlcy5JTExFR0FMX0NPTlRJTlVFKTtcbiAgICAgIH1cblxuICAgICAgcmV0dXJuIG5ldyBTaGlmdC5Db250aW51ZVN0YXRlbWVudChudWxsKTtcbiAgICB9XG5cbiAgICBsZXQgbGFiZWwgPSBudWxsO1xuICAgIGlmICh0aGlzLmxvb2thaGVhZC50eXBlID09IFRva2VuVHlwZS5JREVOVElGSUVSKSB7XG4gICAgICBsYWJlbCA9IHRoaXMucGFyc2VWYXJpYWJsZUlkZW50aWZpZXIoKTtcblxuICAgICAgbGV0IGtleSA9IFwiJFwiICsgbGFiZWwubmFtZTtcbiAgICAgIGlmICghe30uaGFzT3duUHJvcGVydHkuY2FsbCh0aGlzLmxhYmVsU2V0LCBrZXkpKSB7XG4gICAgICAgIHRocm93IHRoaXMuY3JlYXRlRXJyb3IoRXJyb3JNZXNzYWdlcy5VTktOT1dOX0xBQkVMLCBsYWJlbC5uYW1lKTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICB0aGlzLmNvbnN1bWVTZW1pY29sb24oKTtcbiAgICBpZiAoIXRoaXMuaW5JdGVyYXRpb24pIHtcbiAgICAgIHRocm93IHRoaXMuY3JlYXRlRXJyb3JXaXRoVG9rZW4odG9rZW4sIEVycm9yTWVzc2FnZXMuSUxMRUdBTF9DT05USU5VRSk7XG4gICAgfVxuXG4gICAgcmV0dXJuIG5ldyBTaGlmdC5Db250aW51ZVN0YXRlbWVudChsYWJlbCk7XG4gIH1cblxuXG4gIHBhcnNlRGVidWdnZXJTdGF0ZW1lbnQoKSB7XG4gICAgdGhpcy5leHBlY3QoVG9rZW5UeXBlLkRFQlVHR0VSKTtcbiAgICB0aGlzLmNvbnN1bWVTZW1pY29sb24oKTtcbiAgICByZXR1cm4gbmV3IFNoaWZ0LkRlYnVnZ2VyU3RhdGVtZW50O1xuICB9XG5cbiAgcGFyc2VEb1doaWxlU3RhdGVtZW50KCkge1xuICAgIHRoaXMuZXhwZWN0KFRva2VuVHlwZS5ETyk7XG4gICAgbGV0IG9sZEluSXRlcmF0aW9uID0gdGhpcy5pbkl0ZXJhdGlvbjtcbiAgICB0aGlzLmluSXRlcmF0aW9uID0gdHJ1ZTtcblxuICAgIGxldCBib2R5ID0gdGhpcy5wYXJzZVN0YXRlbWVudCgpO1xuICAgIHRoaXMuaW5JdGVyYXRpb24gPSBvbGRJbkl0ZXJhdGlvbjtcblxuICAgIHRoaXMuZXhwZWN0KFRva2VuVHlwZS5XSElMRSk7XG4gICAgdGhpcy5leHBlY3QoVG9rZW5UeXBlLkxQQVJFTik7XG4gICAgbGV0IHRlc3QgPSB0aGlzLnBhcnNlRXhwcmVzc2lvbigpWzBdO1xuICAgIHRoaXMuZXhwZWN0KFRva2VuVHlwZS5SUEFSRU4pO1xuICAgIGlmICh0aGlzLm1hdGNoKFRva2VuVHlwZS5TRU1JQ09MT04pKSB7XG4gICAgICB0aGlzLmxleCgpO1xuICAgIH1cblxuICAgIHJldHVybiBuZXcgU2hpZnQuRG9XaGlsZVN0YXRlbWVudChib2R5LCB0ZXN0KTtcbiAgfVxuXG4gIHN0YXRpYyBpc0xlZnRIYW5kU2lkZShleHByKSB7XG4gICAgc3dpdGNoIChleHByLnR5cGUpIHtcbiAgICAgIGNhc2UgXCJDYWxsRXhwcmVzc2lvblwiOlxuICAgICAgY2FzZSBcIk5ld0V4cHJlc3Npb25cIjpcbiAgICAgIGNhc2UgXCJTdGF0aWNNZW1iZXJFeHByZXNzaW9uXCI6XG4gICAgICBjYXNlIFwiQ29tcHV0ZWRNZW1iZXJFeHByZXNzaW9uXCI6XG4gICAgICBjYXNlIFwiQXJyYXlFeHByZXNzaW9uXCI6XG4gICAgICBjYXNlIFwiRnVuY3Rpb25FeHByZXNzaW9uXCI6XG4gICAgICBjYXNlIFwiSWRlbnRpZmllckV4cHJlc3Npb25cIjpcbiAgICAgIGNhc2UgXCJMaXRlcmFsQm9vbGVhbkV4cHJlc3Npb25cIjpcbiAgICAgIGNhc2UgXCJMaXRlcmFsU3RyaW5nRXhwcmVzc2lvblwiOlxuICAgICAgY2FzZSBcIkxpdGVyYWxOdWxsRXhwcmVzc2lvblwiOlxuICAgICAgY2FzZSBcIkxpdGVyYWxSZWdFeHBFeHByZXNzaW9uXCI6XG4gICAgICBjYXNlIFwiT2JqZWN0RXhwcmVzc2lvblwiOlxuICAgICAgY2FzZSBcIlRoaXNFeHByZXNzaW9uXCI6XG4gICAgICAgIHJldHVybiB0cnVlO1xuICAgIH1cbiAgICByZXR1cm4gZmFsc2U7XG4gIH1cblxuICBwYXJzZUZvclN0YXRlbWVudCgpIHtcbiAgICB0aGlzLmV4cGVjdChUb2tlblR5cGUuRk9SKTtcbiAgICB0aGlzLmV4cGVjdChUb2tlblR5cGUuTFBBUkVOKTtcbiAgICBsZXQgdGVzdCA9IG51bGw7XG4gICAgbGV0IHJpZ2h0ID0gbnVsbDtcbiAgICBpZiAodGhpcy5tYXRjaChUb2tlblR5cGUuU0VNSUNPTE9OKSkge1xuICAgICAgdGhpcy5sZXgoKTtcbiAgICAgIGlmICghdGhpcy5tYXRjaChUb2tlblR5cGUuU0VNSUNPTE9OKSkge1xuICAgICAgICB0ZXN0ID0gdGhpcy5wYXJzZUV4cHJlc3Npb24oKVswXTtcbiAgICAgIH1cbiAgICAgIHRoaXMuZXhwZWN0KFRva2VuVHlwZS5TRU1JQ09MT04pO1xuICAgICAgaWYgKCF0aGlzLm1hdGNoKFRva2VuVHlwZS5SUEFSRU4pKSB7XG4gICAgICAgIHJpZ2h0ID0gdGhpcy5wYXJzZUV4cHJlc3Npb24oKVswXTtcbiAgICAgIH1cbiAgICAgIHJldHVybiBuZXcgU2hpZnQuRm9yU3RhdGVtZW50KFxuICAgICAgICAgIG51bGwsXG4gICAgICAgICAgdGVzdCxcbiAgICAgICAgICByaWdodCxcbiAgICAgICAgICB0aGlzLmdldEl0ZXJhdG9yU3RhdGVtZW50RXBpbG9ndWUoKVxuICAgICAgKTtcbiAgICB9IGVsc2Uge1xuICAgICAgaWYgKHRoaXMubWF0Y2goVG9rZW5UeXBlLlZBUikgfHwgdGhpcy5tYXRjaChUb2tlblR5cGUuTEVUKSkge1xuICAgICAgICBsZXQgcHJldmlvdXNBbGxvd0luID0gdGhpcy5hbGxvd0luO1xuICAgICAgICB0aGlzLmFsbG93SW4gPSBmYWxzZTtcbiAgICAgICAgbGV0IGluaXREZWNsID0gdGhpcy5wYXJzZVZhcmlhYmxlRGVjbGFyYXRpb24oKTtcbiAgICAgICAgdGhpcy5hbGxvd0luID0gcHJldmlvdXNBbGxvd0luO1xuXG4gICAgICAgIGlmIChpbml0RGVjbC5kZWNsYXJhdG9ycy5sZW5ndGggPT09IDEgJiYgdGhpcy5tYXRjaChUb2tlblR5cGUuSU4pKSB7XG4gICAgICAgICAgdGhpcy5sZXgoKTtcbiAgICAgICAgICByaWdodCA9IHRoaXMucGFyc2VFeHByZXNzaW9uKClbMF07XG4gICAgICAgICAgcmV0dXJuIG5ldyBTaGlmdC5Gb3JJblN0YXRlbWVudChpbml0RGVjbCwgcmlnaHQsIHRoaXMuZ2V0SXRlcmF0b3JTdGF0ZW1lbnRFcGlsb2d1ZSgpKTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICB0aGlzLmV4cGVjdChUb2tlblR5cGUuU0VNSUNPTE9OKTtcbiAgICAgICAgICBpZiAoIXRoaXMubWF0Y2goVG9rZW5UeXBlLlNFTUlDT0xPTikpIHtcbiAgICAgICAgICAgIHRlc3QgPSB0aGlzLnBhcnNlRXhwcmVzc2lvbigpWzBdO1xuICAgICAgICAgIH1cbiAgICAgICAgICB0aGlzLmV4cGVjdChUb2tlblR5cGUuU0VNSUNPTE9OKTtcbiAgICAgICAgICBpZiAoIXRoaXMubWF0Y2goVG9rZW5UeXBlLlJQQVJFTikpIHtcbiAgICAgICAgICAgIHJpZ2h0ID0gdGhpcy5wYXJzZUV4cHJlc3Npb24oKVswXTtcbiAgICAgICAgICB9XG4gICAgICAgICAgcmV0dXJuIG5ldyBTaGlmdC5Gb3JTdGF0ZW1lbnQoaW5pdERlY2wsIHRlc3QsIHJpZ2h0LCB0aGlzLmdldEl0ZXJhdG9yU3RhdGVtZW50RXBpbG9ndWUoKSk7XG4gICAgICAgIH1cbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGxldCBwcmV2aW91c0FsbG93SW4gPSB0aGlzLmFsbG93SW47XG4gICAgICAgIHRoaXMuYWxsb3dJbiA9IGZhbHNlO1xuICAgICAgICBsZXQgW2luaXQsIGlzTGVmdEhhbmRTaWRlXSA9IHRoaXMucGFyc2VFeHByZXNzaW9uKCk7XG4gICAgICAgIHRoaXMuYWxsb3dJbiA9IHByZXZpb3VzQWxsb3dJbjtcblxuICAgICAgICBpZiAodGhpcy5tYXRjaChUb2tlblR5cGUuSU4pKSB7XG4gICAgICAgICAgaWYgKCFpc0xlZnRIYW5kU2lkZSkge1xuICAgICAgICAgICAgdGhyb3cgdGhpcy5jcmVhdGVFcnJvcihFcnJvck1lc3NhZ2VzLklOVkFMSURfTEhTX0lOX0ZPUl9JTik7XG4gICAgICAgICAgfVxuXG4gICAgICAgICAgdGhpcy5sZXgoKTtcbiAgICAgICAgICByaWdodCA9IHRoaXMucGFyc2VFeHByZXNzaW9uKClbMF07XG4gICAgICAgICAgcmV0dXJuIG5ldyBTaGlmdC5Gb3JJblN0YXRlbWVudChpbml0LCByaWdodCwgdGhpcy5nZXRJdGVyYXRvclN0YXRlbWVudEVwaWxvZ3VlKCkpO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIHRoaXMuZXhwZWN0KFRva2VuVHlwZS5TRU1JQ09MT04pO1xuICAgICAgICAgIGlmICghdGhpcy5tYXRjaChUb2tlblR5cGUuU0VNSUNPTE9OKSkge1xuICAgICAgICAgICAgdGVzdCA9IHRoaXMucGFyc2VFeHByZXNzaW9uKClbMF07XG4gICAgICAgICAgfVxuICAgICAgICAgIHRoaXMuZXhwZWN0KFRva2VuVHlwZS5TRU1JQ09MT04pO1xuICAgICAgICAgIGlmICghdGhpcy5tYXRjaChUb2tlblR5cGUuUlBBUkVOKSkge1xuICAgICAgICAgICAgcmlnaHQgPSB0aGlzLnBhcnNlRXhwcmVzc2lvbigpWzBdO1xuICAgICAgICAgIH1cbiAgICAgICAgICByZXR1cm4gbmV3IFNoaWZ0LkZvclN0YXRlbWVudChpbml0LCB0ZXN0LCByaWdodCwgdGhpcy5nZXRJdGVyYXRvclN0YXRlbWVudEVwaWxvZ3VlKCkpO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgZ2V0SXRlcmF0b3JTdGF0ZW1lbnRFcGlsb2d1ZSgpIHtcbiAgICB0aGlzLmV4cGVjdChUb2tlblR5cGUuUlBBUkVOKTtcbiAgICBsZXQgb2xkSW5JdGVyYXRpb24gPSB0aGlzLmluSXRlcmF0aW9uO1xuICAgIHRoaXMuaW5JdGVyYXRpb24gPSB0cnVlO1xuICAgIGxldCBib2R5ID0gdGhpcy5wYXJzZVN0YXRlbWVudCgpO1xuICAgIHRoaXMuaW5JdGVyYXRpb24gPSBvbGRJbkl0ZXJhdGlvbjtcbiAgICByZXR1cm4gYm9keTtcbiAgfVxuXG4gIHBhcnNlSWZTdGF0ZW1lbnQoKSB7XG4gICAgdGhpcy5leHBlY3QoVG9rZW5UeXBlLklGKTtcbiAgICB0aGlzLmV4cGVjdChUb2tlblR5cGUuTFBBUkVOKTtcbiAgICBsZXQgdGVzdCA9IHRoaXMucGFyc2VFeHByZXNzaW9uKClbMF07XG5cbiAgICB0aGlzLmV4cGVjdChUb2tlblR5cGUuUlBBUkVOKTtcbiAgICBsZXQgY29uc2VxdWVudCA9IHRoaXMucGFyc2VTdGF0ZW1lbnQoKTtcbiAgICBsZXQgYWx0ZXJuYXRlID0gbnVsbDtcbiAgICBpZiAodGhpcy5tYXRjaChUb2tlblR5cGUuRUxTRSkpIHtcbiAgICAgIHRoaXMubGV4KCk7XG4gICAgICBhbHRlcm5hdGUgPSB0aGlzLnBhcnNlU3RhdGVtZW50KCk7XG4gICAgfVxuICAgIHJldHVybiBuZXcgU2hpZnQuSWZTdGF0ZW1lbnQodGVzdCwgY29uc2VxdWVudCwgYWx0ZXJuYXRlKTtcbiAgfVxuXG4gIHBhcnNlUmV0dXJuU3RhdGVtZW50KCkge1xuICAgIGxldCBhcmd1bWVudCA9IG51bGw7XG5cbiAgICB0aGlzLmV4cGVjdChUb2tlblR5cGUuUkVUVVJOKTtcbiAgICBpZiAoIXRoaXMuaW5GdW5jdGlvbkJvZHkpIHtcbiAgICAgIHRocm93IHRoaXMuY3JlYXRlRXJyb3IoRXJyb3JNZXNzYWdlcy5JTExFR0FMX1JFVFVSTik7XG4gICAgfVxuXG4gICAgaWYgKHRoaXMuaGFzTGluZVRlcm1pbmF0b3JCZWZvcmVOZXh0KSB7XG4gICAgICByZXR1cm4gbmV3IFNoaWZ0LlJldHVyblN0YXRlbWVudChudWxsKTtcbiAgICB9XG5cbiAgICBpZiAoIXRoaXMubWF0Y2goVG9rZW5UeXBlLlNFTUlDT0xPTikpIHtcbiAgICAgIGlmICghdGhpcy5tYXRjaChUb2tlblR5cGUuUkJSQUNFKSAmJiAhdGhpcy5lb2YoKSkge1xuICAgICAgICBhcmd1bWVudCA9IHRoaXMucGFyc2VFeHByZXNzaW9uKClbMF07XG4gICAgICB9XG4gICAgfVxuXG4gICAgdGhpcy5jb25zdW1lU2VtaWNvbG9uKCk7XG4gICAgcmV0dXJuIG5ldyBTaGlmdC5SZXR1cm5TdGF0ZW1lbnQoYXJndW1lbnQpO1xuICB9XG5cbiAgcGFyc2VXaXRoU3RhdGVtZW50KCkge1xuICAgIGlmICh0aGlzLnN0cmljdCkge1xuICAgICAgdGhyb3cgdGhpcy5jcmVhdGVFcnJvcihFcnJvck1lc3NhZ2VzLlNUUklDVF9NT0RFX1dJVEgpO1xuICAgIH1cblxuICAgIHRoaXMuZXhwZWN0KFRva2VuVHlwZS5XSVRIKTtcbiAgICB0aGlzLmV4cGVjdChUb2tlblR5cGUuTFBBUkVOKTtcbiAgICBsZXQgb2JqZWN0ID0gdGhpcy5wYXJzZUV4cHJlc3Npb24oKVswXTtcbiAgICB0aGlzLmV4cGVjdChUb2tlblR5cGUuUlBBUkVOKTtcbiAgICBsZXQgYm9keSA9IHRoaXMucGFyc2VTdGF0ZW1lbnQoKTtcblxuICAgIHJldHVybiBuZXcgU2hpZnQuV2l0aFN0YXRlbWVudChvYmplY3QsIGJvZHkpO1xuICB9XG5cbiAgcGFyc2VTd2l0Y2hTdGF0ZW1lbnQoKSB7XG4gICAgdGhpcy5leHBlY3QoVG9rZW5UeXBlLlNXSVRDSCk7XG4gICAgdGhpcy5leHBlY3QoVG9rZW5UeXBlLkxQQVJFTik7XG4gICAgbGV0IGRpc2NyaW1pbmFudCA9IHRoaXMucGFyc2VFeHByZXNzaW9uKClbMF07XG4gICAgdGhpcy5leHBlY3QoVG9rZW5UeXBlLlJQQVJFTik7XG4gICAgdGhpcy5leHBlY3QoVG9rZW5UeXBlLkxCUkFDRSk7XG5cbiAgICBpZiAodGhpcy5tYXRjaChUb2tlblR5cGUuUkJSQUNFKSkge1xuICAgICAgdGhpcy5sZXgoKTtcbiAgICAgIHJldHVybiBuZXcgU2hpZnQuU3dpdGNoU3RhdGVtZW50KGRpc2NyaW1pbmFudCwgW10pO1xuICAgIH1cbiAgICBsZXQgb2xkSW5Td2l0Y2ggPSB0aGlzLmluU3dpdGNoO1xuICAgIHRoaXMuaW5Td2l0Y2ggPSB0cnVlO1xuXG4gICAgbGV0IGNhc2VzID0gdGhpcy5wYXJzZVN3aXRjaENhc2VzKCk7XG5cbiAgICBpZiAodGhpcy5tYXRjaChUb2tlblR5cGUuREVGQVVMVCkpIHtcbiAgICAgIGxldCBzd2l0Y2hEZWZhdWx0ID0gdGhpcy5wYXJzZVN3aXRjaERlZmF1bHQoKTtcbiAgICAgIGxldCBwb3N0RGVmYXVsdENhc2VzID0gdGhpcy5wYXJzZVN3aXRjaENhc2VzKCk7XG4gICAgICBpZiAodGhpcy5tYXRjaChUb2tlblR5cGUuREVGQVVMVCkpIHtcbiAgICAgICAgdGhyb3cgdGhpcy5jcmVhdGVFcnJvcihFcnJvck1lc3NhZ2VzLk1VTFRJUExFX0RFRkFVTFRTX0lOX1NXSVRDSCk7XG4gICAgICB9XG4gICAgICB0aGlzLmluU3dpdGNoID0gb2xkSW5Td2l0Y2g7XG4gICAgICB0aGlzLmV4cGVjdChUb2tlblR5cGUuUkJSQUNFKTtcbiAgICAgIHJldHVybiBuZXcgU2hpZnQuU3dpdGNoU3RhdGVtZW50V2l0aERlZmF1bHQoZGlzY3JpbWluYW50LCBjYXNlcywgc3dpdGNoRGVmYXVsdCwgcG9zdERlZmF1bHRDYXNlcyk7XG4gICAgfSBlbHNlIHtcbiAgICAgIHRoaXMuaW5Td2l0Y2ggPSBvbGRJblN3aXRjaDtcbiAgICAgIHRoaXMuZXhwZWN0KFRva2VuVHlwZS5SQlJBQ0UpO1xuICAgICAgcmV0dXJuIG5ldyBTaGlmdC5Td2l0Y2hTdGF0ZW1lbnQoZGlzY3JpbWluYW50LCBjYXNlcyk7XG4gICAgfVxuICB9XG5cbiAgcGFyc2VTd2l0Y2hDYXNlcygpIHtcbiAgICBsZXQgcmVzdWx0ID0gW107XG4gICAgd2hpbGUgKCEodGhpcy5lb2YoKSB8fCB0aGlzLm1hdGNoKFRva2VuVHlwZS5SQlJBQ0UpIHx8IHRoaXMubWF0Y2goVG9rZW5UeXBlLkRFRkFVTFQpKSkge1xuICAgICAgcmVzdWx0LnB1c2godGhpcy5wYXJzZVN3aXRjaENhc2UoKSk7XG4gICAgfVxuICAgIHJldHVybiByZXN1bHQ7XG4gIH1cblxuICBwYXJzZVN3aXRjaENhc2UoKSB7XG4gICAgbGV0IHN0YXJ0VG9rZW5JbmRleCA9IHRoaXMudG9rZW5JbmRleDtcbiAgICB0aGlzLmV4cGVjdChUb2tlblR5cGUuQ0FTRSk7XG4gICAgcmV0dXJuIHRoaXMubWFya0xvY2F0aW9uKG5ldyBTaGlmdC5Td2l0Y2hDYXNlKHRoaXMucGFyc2VFeHByZXNzaW9uKClbMF0sIHRoaXMucGFyc2VTd2l0Y2hDYXNlQm9keSgpKSwgc3RhcnRUb2tlbkluZGV4KTtcbiAgfVxuXG4gIHBhcnNlU3dpdGNoRGVmYXVsdCgpIHtcbiAgICBsZXQgc3RhcnRUb2tlbkluZGV4ID0gdGhpcy50b2tlbkluZGV4O1xuICAgIHRoaXMuZXhwZWN0KFRva2VuVHlwZS5ERUZBVUxUKTtcbiAgICByZXR1cm4gdGhpcy5tYXJrTG9jYXRpb24obmV3IFNoaWZ0LlN3aXRjaERlZmF1bHQodGhpcy5wYXJzZVN3aXRjaENhc2VCb2R5KCkpLCBzdGFydFRva2VuSW5kZXgpO1xuICB9XG5cbiAgcGFyc2VTd2l0Y2hDYXNlQm9keSgpIHtcbiAgICB0aGlzLmV4cGVjdChUb2tlblR5cGUuQ09MT04pO1xuICAgIHJldHVybiB0aGlzLnBhcnNlU3RhdGVtZW50TGlzdEluU3dpdGNoQ2FzZUJvZHkoKTtcbiAgfVxuXG4gIHBhcnNlU3RhdGVtZW50TGlzdEluU3dpdGNoQ2FzZUJvZHkoKSB7XG4gICAgbGV0IHJlc3VsdCA9IFtdO1xuICAgIHdoaWxlICghKHRoaXMuZW9mKCkgfHwgdGhpcy5tYXRjaChUb2tlblR5cGUuUkJSQUNFKSB8fCB0aGlzLm1hdGNoKFRva2VuVHlwZS5ERUZBVUxUKVxuICAgIHx8IHRoaXMubWF0Y2goVG9rZW5UeXBlLkNBU0UpKSkge1xuICAgICAgcmVzdWx0LnB1c2godGhpcy5wYXJzZVN0YXRlbWVudCgpKTtcbiAgICB9XG4gICAgcmV0dXJuIHJlc3VsdDtcbiAgfVxuXG4gIHBhcnNlVGhyb3dTdGF0ZW1lbnQoKSB7XG4gICAgbGV0IHRva2VuID0gdGhpcy5leHBlY3QoVG9rZW5UeXBlLlRIUk9XKTtcblxuICAgIGlmICh0aGlzLmhhc0xpbmVUZXJtaW5hdG9yQmVmb3JlTmV4dCkge1xuICAgICAgdGhyb3cgdGhpcy5jcmVhdGVFcnJvcldpdGhUb2tlbih0b2tlbiwgRXJyb3JNZXNzYWdlcy5ORVdMSU5FX0FGVEVSX1RIUk9XKTtcbiAgICB9XG5cbiAgICBsZXQgYXJndW1lbnQgPSB0aGlzLnBhcnNlRXhwcmVzc2lvbigpWzBdO1xuXG4gICAgdGhpcy5jb25zdW1lU2VtaWNvbG9uKCk7XG5cbiAgICByZXR1cm4gbmV3IFNoaWZ0LlRocm93U3RhdGVtZW50KGFyZ3VtZW50KTtcbiAgfVxuXG4gIHBhcnNlVHJ5U3RhdGVtZW50KCkge1xuICAgIHRoaXMuZXhwZWN0KFRva2VuVHlwZS5UUlkpO1xuICAgIGxldCBibG9jayA9IHRoaXMucGFyc2VCbG9jaygpO1xuXG4gICAgaWYgKHRoaXMubWF0Y2goVG9rZW5UeXBlLkNBVENIKSkge1xuICAgICAgbGV0IGhhbmRsZXIgPSB0aGlzLnBhcnNlQ2F0Y2hDbGF1c2UoKTtcbiAgICAgIGlmICh0aGlzLm1hdGNoKFRva2VuVHlwZS5GSU5BTExZKSkge1xuICAgICAgICB0aGlzLmxleCgpO1xuICAgICAgICBsZXQgZmluYWxpemVyID0gdGhpcy5wYXJzZUJsb2NrKCk7XG4gICAgICAgIHJldHVybiBuZXcgU2hpZnQuVHJ5RmluYWxseVN0YXRlbWVudChibG9jaywgaGFuZGxlciwgZmluYWxpemVyKTtcbiAgICAgIH1cbiAgICAgIHJldHVybiBuZXcgU2hpZnQuVHJ5Q2F0Y2hTdGF0ZW1lbnQoYmxvY2ssIGhhbmRsZXIpO1xuICAgIH1cblxuICAgIGlmICh0aGlzLm1hdGNoKFRva2VuVHlwZS5GSU5BTExZKSkge1xuICAgICAgdGhpcy5sZXgoKTtcbiAgICAgIGxldCBmaW5hbGl6ZXIgPSB0aGlzLnBhcnNlQmxvY2soKTtcbiAgICAgIHJldHVybiBuZXcgU2hpZnQuVHJ5RmluYWxseVN0YXRlbWVudChibG9jaywgbnVsbCwgZmluYWxpemVyKTtcbiAgICB9IGVsc2Uge1xuICAgICAgdGhyb3cgdGhpcy5jcmVhdGVFcnJvcihFcnJvck1lc3NhZ2VzLk5PX0NBVENIX09SX0ZJTkFMTFkpO1xuICAgIH1cbiAgfVxuXG4gIHBhcnNlVmFyaWFibGVEZWNsYXJhdGlvblN0YXRlbWVudCgpIHtcbiAgICBsZXQgZGVjbGFyYXRpb24gPSB0aGlzLnBhcnNlVmFyaWFibGVEZWNsYXJhdGlvbigpO1xuICAgIHRoaXMuY29uc3VtZVNlbWljb2xvbigpO1xuICAgIHJldHVybiBuZXcgU2hpZnQuVmFyaWFibGVEZWNsYXJhdGlvblN0YXRlbWVudChkZWNsYXJhdGlvbik7XG4gIH1cblxuICBwYXJzZVdoaWxlU3RhdGVtZW50KCkge1xuICAgIHRoaXMuZXhwZWN0KFRva2VuVHlwZS5XSElMRSk7XG4gICAgdGhpcy5leHBlY3QoVG9rZW5UeXBlLkxQQVJFTik7XG4gICAgcmV0dXJuIG5ldyBTaGlmdC5XaGlsZVN0YXRlbWVudCh0aGlzLnBhcnNlRXhwcmVzc2lvbigpWzBdLCB0aGlzLmdldEl0ZXJhdG9yU3RhdGVtZW50RXBpbG9ndWUoKSk7XG4gIH1cblxuICBwYXJzZUNhdGNoQ2xhdXNlKCkge1xuICAgIGxldCBzdGFydFRva2VuSW5kZXggPSB0aGlzLnRva2VuSW5kZXg7XG5cbiAgICB0aGlzLmV4cGVjdChUb2tlblR5cGUuQ0FUQ0gpO1xuICAgIHRoaXMuZXhwZWN0KFRva2VuVHlwZS5MUEFSRU4pO1xuICAgIGlmICh0aGlzLm1hdGNoKFRva2VuVHlwZS5SUEFSRU4pKSB7XG4gICAgICB0aHJvdyB0aGlzLmNyZWF0ZVVuZXhwZWN0ZWQodGhpcy5sb29rYWhlYWQpO1xuICAgIH1cblxuICAgIGxldCBwYXJhbSA9IHRoaXMucGFyc2VWYXJpYWJsZUlkZW50aWZpZXIoKTtcblxuICAgIC8vIDEyLjE0LjE7XG4gICAgaWYgKHRoaXMuc3RyaWN0ICYmIGlzUmVzdHJpY3RlZFdvcmQocGFyYW0ubmFtZSkpIHtcbiAgICAgIHRocm93IHRoaXMuY3JlYXRlRXJyb3IoRXJyb3JNZXNzYWdlcy5TVFJJQ1RfQ0FUQ0hfVkFSSUFCTEUpO1xuICAgIH1cblxuICAgIHRoaXMuZXhwZWN0KFRva2VuVHlwZS5SUEFSRU4pO1xuXG4gICAgbGV0IGJvZHkgPSB0aGlzLnBhcnNlQmxvY2soKTtcblxuICAgIHJldHVybiB0aGlzLm1hcmtMb2NhdGlvbihuZXcgU2hpZnQuQ2F0Y2hDbGF1c2UocGFyYW0sIGJvZHkpLCBzdGFydFRva2VuSW5kZXgpO1xuICB9XG5cbiAgcGFyc2VCbG9jaygpIHtcbiAgICBsZXQgc3RhcnRUb2tlbkluZGV4ID0gdGhpcy50b2tlbkluZGV4O1xuICAgIHRoaXMuZXhwZWN0KFRva2VuVHlwZS5MQlJBQ0UpO1xuXG4gICAgbGV0IGJvZHkgPSBbXTtcbiAgICB3aGlsZSAoIXRoaXMubWF0Y2goVG9rZW5UeXBlLlJCUkFDRSkpIHtcbiAgICAgIGJvZHkucHVzaCh0aGlzLnBhcnNlU3RhdGVtZW50KCkpO1xuICAgIH1cbiAgICB0aGlzLmV4cGVjdChUb2tlblR5cGUuUkJSQUNFKTtcblxuICAgIHJldHVybiB0aGlzLm1hcmtMb2NhdGlvbihuZXcgU2hpZnQuQmxvY2soYm9keSksIHN0YXJ0VG9rZW5JbmRleCk7XG4gIH1cblxuICBwYXJzZVZhcmlhYmxlRGVjbGFyYXRpb24oKSB7XG4gICAgbGV0IHN0YXJ0VG9rZW5JbmRleCA9IHRoaXMudG9rZW5JbmRleDtcbiAgICBsZXQgdG9rZW4gPSB0aGlzLmxleCgpO1xuXG4gICAgLy8gUHJlY2VkZWQgYnkgdGhpcy5tYXRjaChUb2tlblN1YlR5cGUuVkFSKSB8fCB0aGlzLm1hdGNoKFRva2VuU3ViVHlwZS5MRVQpO1xuICAgIGxldCBraW5kID0gdG9rZW4udHlwZSA9PSBUb2tlblR5cGUuVkFSID8gXCJ2YXJcIiA6IHRva2VuLnR5cGUgPT09IFRva2VuVHlwZS5DT05TVCA/IFwiY29uc3RcIiA6IFwibGV0XCI7XG4gICAgbGV0IGRlY2xhcmF0b3JzID0gdGhpcy5wYXJzZVZhcmlhYmxlRGVjbGFyYXRvckxpc3Qoa2luZCk7XG4gICAgcmV0dXJuIHRoaXMubWFya0xvY2F0aW9uKG5ldyBTaGlmdC5WYXJpYWJsZURlY2xhcmF0aW9uKGtpbmQsIGRlY2xhcmF0b3JzKSwgc3RhcnRUb2tlbkluZGV4KTtcbiAgfVxuXG4gIHBhcnNlVmFyaWFibGVEZWNsYXJhdG9yTGlzdChraW5kKSB7XG4gICAgbGV0IHJlc3VsdCA9IFtdO1xuICAgIHdoaWxlICh0cnVlKSB7XG4gICAgICByZXN1bHQucHVzaCh0aGlzLnBhcnNlVmFyaWFibGVEZWNsYXJhdG9yKGtpbmQpKTtcbiAgICAgIGlmICghdGhpcy5lYXQoVG9rZW5UeXBlLkNPTU1BKSkge1xuICAgICAgICByZXR1cm4gcmVzdWx0O1xuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIHBhcnNlVmFyaWFibGVEZWNsYXJhdG9yKGtpbmQpIHtcbiAgICBsZXQgc3RhcnRUb2tlbkluZGV4ID0gdGhpcy50b2tlbkluZGV4O1xuXG4gICAgbGV0IGlkID0gdGhpcy5wYXJzZVZhcmlhYmxlSWRlbnRpZmllcigpO1xuXG4gICAgLy8gMTIuMi4xO1xuICAgIGlmICh0aGlzLnN0cmljdCAmJiBpc1Jlc3RyaWN0ZWRXb3JkKGlkLm5hbWUpKSB7XG4gICAgICB0aHJvdyB0aGlzLmNyZWF0ZUVycm9yKEVycm9yTWVzc2FnZXMuU1RSSUNUX1ZBUl9OQU1FKTtcbiAgICB9XG5cbiAgICBsZXQgaW5pdCA9IG51bGw7XG4gICAgaWYgKGtpbmQgPT0gXCJjb25zdFwiKSB7XG4gICAgICB0aGlzLmV4cGVjdChUb2tlblR5cGUuQVNTSUdOKTtcbiAgICAgIGluaXQgPSB0aGlzLnBhcnNlQXNzaWdubWVudEV4cHJlc3Npb24oKVswXTtcbiAgICB9IGVsc2UgaWYgKHRoaXMubWF0Y2goVG9rZW5UeXBlLkFTU0lHTikpIHtcbiAgICAgIHRoaXMubGV4KCk7XG4gICAgICBpbml0ID0gdGhpcy5wYXJzZUFzc2lnbm1lbnRFeHByZXNzaW9uKClbMF07XG4gICAgfVxuICAgIHJldHVybiB0aGlzLm1hcmtMb2NhdGlvbihuZXcgU2hpZnQuVmFyaWFibGVEZWNsYXJhdG9yKGlkLCBpbml0KSwgc3RhcnRUb2tlbkluZGV4KTtcbiAgfVxuXG4gIHBhcnNlRXhwcmVzc2lvbigpIHtcbiAgICBsZXQgc3RhcnRUb2tlbkluZGV4ID0gdGhpcy50b2tlbkluZGV4O1xuXG4gICAgbGV0IFtleHByLCBpc0xlZnRIYW5kU2lkZV0gPSB0aGlzLnBhcnNlQXNzaWdubWVudEV4cHJlc3Npb24oKTtcblxuICAgIGlmICh0aGlzLm1hdGNoKFRva2VuVHlwZS5DT01NQSkpIHtcbiAgICAgIHdoaWxlICghdGhpcy5lb2YoKSkge1xuICAgICAgICBpZiAoIXRoaXMubWF0Y2goVG9rZW5UeXBlLkNPTU1BKSkge1xuICAgICAgICAgIGJyZWFrO1xuICAgICAgICB9XG4gICAgICAgIHRoaXMubGV4KCk7XG4gICAgICAgIGV4cHIgPSB0aGlzLm1hcmtMb2NhdGlvbihuZXcgU2hpZnQuQmluYXJ5RXhwcmVzc2lvbihcIixcIiwgZXhwciwgdGhpcy5wYXJzZUFzc2lnbm1lbnRFeHByZXNzaW9uKClbMF0pLCBzdGFydFRva2VuSW5kZXgpO1xuICAgICAgICBpc0xlZnRIYW5kU2lkZSA9IGZhbHNlO1xuICAgICAgfVxuICAgIH1cbiAgICByZXR1cm4gW2V4cHIsIGlzTGVmdEhhbmRTaWRlXTtcbiAgfVxuXG4gIHBhcnNlQXNzaWdubWVudEV4cHJlc3Npb24oKSB7XG4gICAgbGV0IHRva2VuID0gdGhpcy5sb29rYWhlYWQ7XG4gICAgbGV0IHN0YXJ0VG9rZW5JbmRleCA9IHRoaXMudG9rZW5JbmRleDtcblxuICAgIGxldCBbbm9kZSwgaXNMZWZ0SGFuZFNpZGVdID0gdGhpcy5wYXJzZUNvbmRpdGlvbmFsRXhwcmVzc2lvbigpO1xuXG4gICAgbGV0IGlzT3BlcmF0b3IgPSBmYWxzZTtcbiAgICBsZXQgb3BlcmF0b3IgPSB0aGlzLmxvb2thaGVhZDtcbiAgICBzd2l0Y2ggKG9wZXJhdG9yLnR5cGUpIHtcbiAgICAgIGNhc2UgVG9rZW5UeXBlLkFTU0lHTjpcbiAgICAgIGNhc2UgVG9rZW5UeXBlLkFTU0lHTl9CSVRfT1I6XG4gICAgICBjYXNlIFRva2VuVHlwZS5BU1NJR05fQklUX1hPUjpcbiAgICAgIGNhc2UgVG9rZW5UeXBlLkFTU0lHTl9CSVRfQU5EOlxuICAgICAgY2FzZSBUb2tlblR5cGUuQVNTSUdOX1NITDpcbiAgICAgIGNhc2UgVG9rZW5UeXBlLkFTU0lHTl9TSFI6XG4gICAgICBjYXNlIFRva2VuVHlwZS5BU1NJR05fU0hSX1VOU0lHTkVEOlxuICAgICAgY2FzZSBUb2tlblR5cGUuQVNTSUdOX0FERDpcbiAgICAgIGNhc2UgVG9rZW5UeXBlLkFTU0lHTl9TVUI6XG4gICAgICBjYXNlIFRva2VuVHlwZS5BU1NJR05fTVVMOlxuICAgICAgY2FzZSBUb2tlblR5cGUuQVNTSUdOX0RJVjpcbiAgICAgIGNhc2UgVG9rZW5UeXBlLkFTU0lHTl9NT0Q6XG4gICAgICAgIGlzT3BlcmF0b3IgPSB0cnVlO1xuICAgICAgICBicmVhaztcbiAgICB9XG5cbiAgICBpZiAoaXNPcGVyYXRvcikge1xuICAgICAgaWYgKCFpc0xlZnRIYW5kU2lkZSkge1xuICAgICAgICB0aHJvdyB0aGlzLmNyZWF0ZUVycm9yKEVycm9yTWVzc2FnZXMuSU5WQUxJRF9MSFNfSU5fQVNTSUdOTUVOVCk7XG4gICAgICB9XG5cbiAgICAgIC8vIDExLjEzLjE7XG4gICAgICBpZiAobm9kZS50eXBlID09PSBcIklkZW50aWZpZXJFeHByZXNzaW9uXCIpIHtcbiAgICAgICAgaWYgKHRoaXMuc3RyaWN0ICYmIGlzUmVzdHJpY3RlZFdvcmQobm9kZS5pZGVudGlmaWVyLm5hbWUpKSB7XG4gICAgICAgICAgdGhyb3cgdGhpcy5jcmVhdGVFcnJvcldpdGhUb2tlbih0b2tlbiwgRXJyb3JNZXNzYWdlcy5TVFJJQ1RfTEhTX0FTU0lHTk1FTlQpO1xuICAgICAgICB9XG4gICAgICB9XG5cbiAgICAgIHRoaXMubGV4KCk7XG4gICAgICBsZXQgcmlnaHQgPSB0aGlzLnBhcnNlQXNzaWdubWVudEV4cHJlc3Npb24oKVswXTtcbiAgICAgIG5vZGUgPSB0aGlzLm1hcmtMb2NhdGlvbihuZXcgU2hpZnQuQXNzaWdubWVudEV4cHJlc3Npb24ob3BlcmF0b3IudHlwZS5uYW1lLCBub2RlLCByaWdodCksIHN0YXJ0VG9rZW5JbmRleCk7XG4gICAgICBpc0xlZnRIYW5kU2lkZSA9IGZhbHNlO1xuICAgIH1cbiAgICByZXR1cm4gW25vZGUsIGlzTGVmdEhhbmRTaWRlXTtcbiAgfVxuXG4gIHBhcnNlQ29uZGl0aW9uYWxFeHByZXNzaW9uKCkge1xuICAgIGxldCBzdGFydFRva2VuSW5kZXggPSB0aGlzLnRva2VuSW5kZXg7XG4gICAgbGV0IFtleHByLCBpc0xlZnRIYW5kU2lkZV0gPSB0aGlzLnBhcnNlQmluYXJ5RXhwcmVzc2lvbigpO1xuICAgIGlmICh0aGlzLm1hdGNoKFRva2VuVHlwZS5DT05ESVRJT05BTCkpIHtcbiAgICAgIHRoaXMubGV4KCk7XG4gICAgICBsZXQgcHJldmlvdXNBbGxvd0luID0gdGhpcy5hbGxvd0luO1xuICAgICAgdGhpcy5hbGxvd0luID0gdHJ1ZTtcbiAgICAgIGxldCBjb25zZXF1ZW50ID0gdGhpcy5wYXJzZUFzc2lnbm1lbnRFeHByZXNzaW9uKClbMF07XG4gICAgICB0aGlzLmFsbG93SW4gPSBwcmV2aW91c0FsbG93SW47XG4gICAgICB0aGlzLmV4cGVjdChUb2tlblR5cGUuQ09MT04pO1xuICAgICAgbGV0IGFsdGVybmF0ZSA9IHRoaXMucGFyc2VBc3NpZ25tZW50RXhwcmVzc2lvbigpWzBdO1xuICAgICAgZXhwciA9IHRoaXMubWFya0xvY2F0aW9uKG5ldyBTaGlmdC5Db25kaXRpb25hbEV4cHJlc3Npb24oZXhwciwgY29uc2VxdWVudCwgYWx0ZXJuYXRlKSwgc3RhcnRUb2tlbkluZGV4KTtcbiAgICAgIGlzTGVmdEhhbmRTaWRlID0gZmFsc2U7XG4gICAgfVxuXG4gICAgcmV0dXJuIFtleHByLCBpc0xlZnRIYW5kU2lkZV07XG4gIH1cblxuICBpc0JpbmFyeU9wZXJhdG9yKHR5cGUpIHtcbiAgICBzd2l0Y2ggKHR5cGUpIHtcbiAgICAgIGNhc2UgVG9rZW5UeXBlLk9SOlxuICAgICAgY2FzZSBUb2tlblR5cGUuQU5EOlxuICAgICAgY2FzZSBUb2tlblR5cGUuQklUX09SOlxuICAgICAgY2FzZSBUb2tlblR5cGUuQklUX1hPUjpcbiAgICAgIGNhc2UgVG9rZW5UeXBlLkJJVF9BTkQ6XG4gICAgICBjYXNlIFRva2VuVHlwZS5FUTpcbiAgICAgIGNhc2UgVG9rZW5UeXBlLk5FOlxuICAgICAgY2FzZSBUb2tlblR5cGUuRVFfU1RSSUNUOlxuICAgICAgY2FzZSBUb2tlblR5cGUuTkVfU1RSSUNUOlxuICAgICAgY2FzZSBUb2tlblR5cGUuTFQ6XG4gICAgICBjYXNlIFRva2VuVHlwZS5HVDpcbiAgICAgIGNhc2UgVG9rZW5UeXBlLkxURTpcbiAgICAgIGNhc2UgVG9rZW5UeXBlLkdURTpcbiAgICAgIGNhc2UgVG9rZW5UeXBlLklOU1RBTkNFT0Y6XG4gICAgICBjYXNlIFRva2VuVHlwZS5TSEw6XG4gICAgICBjYXNlIFRva2VuVHlwZS5TSFI6XG4gICAgICBjYXNlIFRva2VuVHlwZS5TSFJfVU5TSUdORUQ6XG4gICAgICBjYXNlIFRva2VuVHlwZS5BREQ6XG4gICAgICBjYXNlIFRva2VuVHlwZS5TVUI6XG4gICAgICBjYXNlIFRva2VuVHlwZS5NVUw6XG4gICAgICBjYXNlIFRva2VuVHlwZS5ESVY6XG4gICAgICBjYXNlIFRva2VuVHlwZS5NT0Q6XG4gICAgICAgIHJldHVybiB0cnVlO1xuICAgICAgY2FzZSBUb2tlblR5cGUuSU46XG4gICAgICAgIHJldHVybiB0aGlzLmFsbG93SW47XG4gICAgICBkZWZhdWx0OlxuICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgfVxuICB9XG5cbiAgcGFyc2VCaW5hcnlFeHByZXNzaW9uKCkge1xuICAgIGxldCBbbGVmdCwgaXNMZWZ0SGFuZFNpZGVdID0gdGhpcy5wYXJzZVVuYXJ5RXhwcmVzc2lvbigpO1xuICAgIGxldCBvcGVyYXRvciA9IHRoaXMubG9va2FoZWFkLnR5cGU7XG5cbiAgICBsZXQgaXNCaW5hcnlPcGVyYXRvciA9IHRoaXMuaXNCaW5hcnlPcGVyYXRvcihvcGVyYXRvcik7XG4gICAgaWYgKCFpc0JpbmFyeU9wZXJhdG9yKSB7XG4gICAgICByZXR1cm4gW2xlZnQsIGlzTGVmdEhhbmRTaWRlXTtcbiAgICB9XG5cbiAgICB0aGlzLmxleCgpO1xuICAgIGxldCBzdGFjayA9IFtdO1xuICAgIHN0YWNrLnB1c2goe3N0YXJ0SW5kZXg6IHRoaXMudG9rZW5JbmRleCwgbGVmdCwgb3BlcmF0b3IsIHByZWNlZGVuY2U6IEJpbmFyeVByZWNlZGVuY2Vbb3BlcmF0b3IubmFtZV19KTtcbiAgICBsZXQgcmlnaHQgPSB0aGlzLnBhcnNlVW5hcnlFeHByZXNzaW9uKClbMF07XG5cbiAgICBvcGVyYXRvciA9IHRoaXMubG9va2FoZWFkLnR5cGU7XG4gICAgaXNCaW5hcnlPcGVyYXRvciA9IHRoaXMuaXNCaW5hcnlPcGVyYXRvcih0aGlzLmxvb2thaGVhZC50eXBlKTtcbiAgICB3aGlsZSAoaXNCaW5hcnlPcGVyYXRvcikge1xuICAgICAgbGV0IHByZWNlZGVuY2UgPSBCaW5hcnlQcmVjZWRlbmNlW29wZXJhdG9yLm5hbWVdO1xuICAgICAgLy8gUmVkdWNlOiBtYWtlIGEgYmluYXJ5IGV4cHJlc3Npb24gZnJvbSB0aGUgdGhyZWUgdG9wbW9zdCBlbnRyaWVzLlxuICAgICAgd2hpbGUgKHN0YWNrLmxlbmd0aCAmJiAocHJlY2VkZW5jZSA8PSBzdGFja1tzdGFjay5sZW5ndGggLSAxXS5wcmVjZWRlbmNlKSkge1xuICAgICAgICBsZXQgc3RhY2tJdGVtID0gc3RhY2tbc3RhY2subGVuZ3RoIC0gMV07XG4gICAgICAgIGxldCBzdGFja09wZXJhdG9yID0gc3RhY2tJdGVtLm9wZXJhdG9yO1xuICAgICAgICBsZWZ0ID0gc3RhY2tJdGVtLmxlZnQ7XG4gICAgICAgIHN0YWNrLnBvcCgpO1xuICAgICAgICByaWdodCA9IHRoaXMubWFya0xvY2F0aW9uKFxuICAgICAgICAgICAgbmV3IFNoaWZ0LkJpbmFyeUV4cHJlc3Npb24oc3RhY2tPcGVyYXRvci5uYW1lLCBsZWZ0LCByaWdodCksXG4gICAgICAgICAgICBzdGFja0l0ZW0uc3RhcnRJbmRleCxcbiAgICAgICAgICAgIHRoaXMudG9rZW5JbmRleCk7XG4gICAgICB9XG5cbiAgICAgIC8vIFNoaWZ0LlxuICAgICAgdGhpcy5sZXgoKTtcbiAgICAgIHN0YWNrLnB1c2goe3N0YXJ0SW5kZXg6IHRoaXMudG9rZW5JbmRleCwgbGVmdDogcmlnaHQsIG9wZXJhdG9yLCBwcmVjZWRlbmNlfSk7XG4gICAgICByaWdodCA9IHRoaXMucGFyc2VVbmFyeUV4cHJlc3Npb24oKVswXTtcblxuICAgICAgb3BlcmF0b3IgPSB0aGlzLmxvb2thaGVhZC50eXBlO1xuICAgICAgaXNCaW5hcnlPcGVyYXRvciA9IHRoaXMuaXNCaW5hcnlPcGVyYXRvcihvcGVyYXRvcik7XG4gICAgfVxuXG4gICAgLy8gRmluYWwgcmVkdWNlIHRvIGNsZWFuLXVwIHRoZSBzdGFjay5cbiAgICByZXR1cm4gW3N0YWNrLnJlZHVjZVJpZ2h0KFxuICAgICAgICAoZXhwciwgc3RhY2tJdGVtKSA9PiB0aGlzLm1hcmtMb2NhdGlvbihcbiAgICAgICAgICAgIG5ldyBTaGlmdC5CaW5hcnlFeHByZXNzaW9uKHN0YWNrSXRlbS5vcGVyYXRvci5uYW1lLCBzdGFja0l0ZW0ubGVmdCwgZXhwciksXG4gICAgICAgICAgICBzdGFja0l0ZW0uc3RhcnRJbmRleCxcbiAgICAgICAgICAgIHRoaXMudG9rZW5JbmRleCksXG4gICAgICAgIHJpZ2h0KSwgZmFsc2VdO1xuICB9XG5cbiAgc3RhdGljIGlzUHJlZml4T3BlcmF0b3IodHlwZSkge1xuICAgIHN3aXRjaCAodHlwZSkge1xuICAgICAgY2FzZSBUb2tlblR5cGUuSU5DOlxuICAgICAgY2FzZSBUb2tlblR5cGUuREVDOlxuICAgICAgY2FzZSBUb2tlblR5cGUuQUREOlxuICAgICAgY2FzZSBUb2tlblR5cGUuU1VCOlxuICAgICAgY2FzZSBUb2tlblR5cGUuQklUX05PVDpcbiAgICAgIGNhc2UgVG9rZW5UeXBlLk5PVDpcbiAgICAgIGNhc2UgVG9rZW5UeXBlLkRFTEVURTpcbiAgICAgIGNhc2UgVG9rZW5UeXBlLlZPSUQ6XG4gICAgICBjYXNlIFRva2VuVHlwZS5UWVBFT0Y6XG4gICAgICAgIHJldHVybiB0cnVlO1xuICAgIH1cbiAgICByZXR1cm4gZmFsc2U7XG4gIH1cblxuICBwYXJzZVVuYXJ5RXhwcmVzc2lvbigpIHtcbiAgICBpZiAodGhpcy5sb29rYWhlYWQudHlwZS5rbGFzcyAhPSBUb2tlbkNsYXNzLlB1bmN0dWF0b3IgJiYgdGhpcy5sb29rYWhlYWQudHlwZS5rbGFzcyAhPSBUb2tlbkNsYXNzLktleXdvcmQpIHtcbiAgICAgIHJldHVybiB0aGlzLnBhcnNlUG9zdGZpeEV4cHJlc3Npb24oKTtcbiAgICB9XG4gICAgbGV0IHN0YXJ0VG9rZW5JbmRleCA9IHRoaXMudG9rZW5JbmRleDtcbiAgICBsZXQgb3BlcmF0b3IgPSB0aGlzLmxvb2thaGVhZDtcbiAgICBpZiAoIVBhcnNlci5pc1ByZWZpeE9wZXJhdG9yKG9wZXJhdG9yLnR5cGUpKSB7XG4gICAgICByZXR1cm4gdGhpcy5wYXJzZVBvc3RmaXhFeHByZXNzaW9uKCk7XG4gICAgfVxuICAgIHRoaXMubGV4KCk7XG4gICAgbGV0IGV4cHIgPSB0aGlzLnBhcnNlVW5hcnlFeHByZXNzaW9uKClbMF07XG4gICAgc3dpdGNoIChvcGVyYXRvci50eXBlKSB7XG4gICAgICBjYXNlIFRva2VuVHlwZS5JTkM6XG4gICAgICBjYXNlIFRva2VuVHlwZS5ERUM6XG4gICAgICAgIC8vIDExLjQuNCwgMTEuNC41O1xuICAgICAgICBpZiAoZXhwci50eXBlID09PSBcIklkZW50aWZpZXJFeHByZXNzaW9uXCIpIHtcbiAgICAgICAgICBpZiAodGhpcy5zdHJpY3QgJiYgaXNSZXN0cmljdGVkV29yZChleHByLmlkZW50aWZpZXIubmFtZSkpIHtcbiAgICAgICAgICAgIHRocm93IHRoaXMuY3JlYXRlRXJyb3IoRXJyb3JNZXNzYWdlcy5TVFJJQ1RfTEhTX1BSRUZJWCk7XG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICAgIGJyZWFrO1xuICAgICAgY2FzZSBUb2tlblR5cGUuREVMRVRFOlxuICAgICAgICBpZiAoZXhwci50eXBlID09PSBcIklkZW50aWZpZXJFeHByZXNzaW9uXCIgJiYgdGhpcy5zdHJpY3QpIHtcbiAgICAgICAgICB0aHJvdyB0aGlzLmNyZWF0ZUVycm9yKEVycm9yTWVzc2FnZXMuU1RSSUNUX0RFTEVURSk7XG4gICAgICAgIH1cbiAgICAgICAgYnJlYWs7XG4gICAgICBkZWZhdWx0OlxuICAgICAgICBicmVhaztcbiAgICB9XG5cbiAgICBleHByID0gdGhpcy5tYXJrTG9jYXRpb24obmV3IFNoaWZ0LlByZWZpeEV4cHJlc3Npb24ob3BlcmF0b3IudmFsdWUsIGV4cHIpLCBzdGFydFRva2VuSW5kZXgpO1xuICAgIHJldHVybiBbZXhwciwgZmFsc2VdO1xuICB9XG5cbiAgcGFyc2VQb3N0Zml4RXhwcmVzc2lvbigpIHtcbiAgICBsZXQgc3RhcnRUb2tlbkluZGV4ID0gdGhpcy50b2tlbkluZGV4O1xuXG4gICAgbGV0IGV4cHIgPSB0aGlzLnBhcnNlTGVmdEhhbmRTaWRlRXhwcmVzc2lvbkFsbG93Q2FsbCgpO1xuXG4gICAgaWYgKHRoaXMuaGFzTGluZVRlcm1pbmF0b3JCZWZvcmVOZXh0KSB7XG4gICAgICByZXR1cm4gW2V4cHIsIHRydWVdO1xuICAgIH1cblxuICAgIGxldCBvcGVyYXRvciA9IHRoaXMubG9va2FoZWFkO1xuICAgIGlmICgob3BlcmF0b3IudHlwZSAhPT0gVG9rZW5UeXBlLklOQykgJiYgKG9wZXJhdG9yLnR5cGUgIT09IFRva2VuVHlwZS5ERUMpKSB7XG4gICAgICByZXR1cm4gW2V4cHIsIHRydWVdO1xuICAgIH1cbiAgICB0aGlzLmxleCgpO1xuICAgIC8vIDExLjMuMSwgMTEuMy4yO1xuICAgIGlmIChleHByLnR5cGUgPT09IFwiSWRlbnRpZmllckV4cHJlc3Npb25cIikge1xuICAgICAgaWYgKHRoaXMuc3RyaWN0ICYmIGlzUmVzdHJpY3RlZFdvcmQoZXhwci5pZGVudGlmaWVyLm5hbWUpKSB7XG4gICAgICAgIHRocm93IHRoaXMuY3JlYXRlRXJyb3IoRXJyb3JNZXNzYWdlcy5TVFJJQ1RfTEhTX1BPU1RGSVgpO1xuICAgICAgfVxuICAgIH1cbiAgICByZXR1cm4gW3RoaXMubWFya0xvY2F0aW9uKG5ldyBTaGlmdC5Qb3N0Zml4RXhwcmVzc2lvbihleHByLCBvcGVyYXRvci52YWx1ZSksIHN0YXJ0VG9rZW5JbmRleCksIGZhbHNlXTtcbiAgfVxuXG4gIHBhcnNlTGVmdEhhbmRTaWRlRXhwcmVzc2lvbkFsbG93Q2FsbCgpIHtcbiAgICBsZXQgc3RhcnRUb2tlbkluZGV4ID0gdGhpcy50b2tlbkluZGV4O1xuICAgIGxldCBwcmV2aW91c0FsbG93SW4gPSB0aGlzLmFsbG93SW47XG4gICAgdGhpcy5hbGxvd0luID0gdHJ1ZTtcbiAgICBsZXQgZXhwciA9IHRoaXMubWF0Y2goVG9rZW5UeXBlLk5FVykgPyB0aGlzLnBhcnNlTmV3RXhwcmVzc2lvbigpIDogdGhpcy5wYXJzZVByaW1hcnlFeHByZXNzaW9uKCk7XG5cbiAgICB3aGlsZSAodHJ1ZSkge1xuICAgICAgaWYgKHRoaXMubWF0Y2goVG9rZW5UeXBlLkxQQVJFTikpIHtcbiAgICAgICAgZXhwciA9IHRoaXMubWFya0xvY2F0aW9uKG5ldyBTaGlmdC5DYWxsRXhwcmVzc2lvbihleHByLCB0aGlzLnBhcnNlQXJndW1lbnRMaXN0KCkpLCBzdGFydFRva2VuSW5kZXgpO1xuICAgICAgfSBlbHNlIGlmICh0aGlzLm1hdGNoKFRva2VuVHlwZS5MQlJBQ0spKSB7XG4gICAgICAgIGV4cHIgPSB0aGlzLm1hcmtMb2NhdGlvbihuZXcgU2hpZnQuQ29tcHV0ZWRNZW1iZXJFeHByZXNzaW9uKGV4cHIsIHRoaXMucGFyc2VDb21wdXRlZE1lbWJlcigpKSwgc3RhcnRUb2tlbkluZGV4KTtcbiAgICAgIH0gZWxzZSBpZiAodGhpcy5tYXRjaChUb2tlblR5cGUuUEVSSU9EKSkge1xuICAgICAgICBleHByID0gdGhpcy5tYXJrTG9jYXRpb24obmV3IFNoaWZ0LlN0YXRpY01lbWJlckV4cHJlc3Npb24oZXhwciwgdGhpcy5wYXJzZU5vbkNvbXB1dGVkTWVtYmVyKCkpLCBzdGFydFRva2VuSW5kZXgpO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgYnJlYWs7XG4gICAgICB9XG4gICAgfVxuXG4gICAgdGhpcy5hbGxvd0luID0gcHJldmlvdXNBbGxvd0luO1xuXG4gICAgcmV0dXJuIGV4cHI7XG4gIH1cblxuICBwYXJzZUxlZnRIYW5kU2lkZUV4cHJlc3Npb24oKSB7XG4gICAgbGV0IHN0YXJ0VG9rZW5JbmRleCA9IHRoaXMudG9rZW5JbmRleDtcblxuICAgIGxldCBleHByID0gdGhpcy5tYXRjaChUb2tlblR5cGUuTkVXKSA/IHRoaXMucGFyc2VOZXdFeHByZXNzaW9uKCkgOiB0aGlzLnBhcnNlUHJpbWFyeUV4cHJlc3Npb24oKTtcblxuICAgIHdoaWxlICh0aGlzLm1hdGNoKFRva2VuVHlwZS5QRVJJT0QpIHx8IHRoaXMubWF0Y2goVG9rZW5UeXBlLkxCUkFDSykpIHtcbiAgICAgIGV4cHIgPSB0aGlzLm1hcmtMb2NhdGlvbihcbiAgICAgICAgICB0aGlzLm1hdGNoKFRva2VuVHlwZS5MQlJBQ0spID9cbiAgICAgICAgICAgICAgbmV3IFNoaWZ0LkNvbXB1dGVkTWVtYmVyRXhwcmVzc2lvbihleHByLCB0aGlzLnBhcnNlQ29tcHV0ZWRNZW1iZXIoKSkgOlxuICAgICAgICAgICAgICBuZXcgU2hpZnQuU3RhdGljTWVtYmVyRXhwcmVzc2lvbihleHByLCB0aGlzLnBhcnNlTm9uQ29tcHV0ZWRNZW1iZXIoKSksIHN0YXJ0VG9rZW5JbmRleCk7XG4gICAgfVxuXG4gICAgcmV0dXJuIGV4cHI7XG4gIH1cblxuICBwYXJzZU5vbkNvbXB1dGVkTWVtYmVyKCkge1xuICAgIHRoaXMuZXhwZWN0KFRva2VuVHlwZS5QRVJJT0QpO1xuICAgIHJldHVybiB0aGlzLnBhcnNlTm9uQ29tcHV0ZWRQcm9wZXJ0eSgpO1xuICB9XG5cbiAgcGFyc2VDb21wdXRlZE1lbWJlcigpIHtcbiAgICB0aGlzLmV4cGVjdChUb2tlblR5cGUuTEJSQUNLKTtcbiAgICBsZXQgZXhwciA9IHRoaXMucGFyc2VFeHByZXNzaW9uKClbMF07XG4gICAgdGhpcy5leHBlY3QoVG9rZW5UeXBlLlJCUkFDSyk7XG4gICAgcmV0dXJuIGV4cHI7XG4gIH1cblxuICBwYXJzZU5ld0V4cHJlc3Npb24oKSB7XG4gICAgbGV0IHN0YXJ0VG9rZW5JbmRleCA9IHRoaXMudG9rZW5JbmRleDtcbiAgICB0aGlzLmV4cGVjdChUb2tlblR5cGUuTkVXKTtcbiAgICBsZXQgY2FsbGVlID0gdGhpcy5wYXJzZUxlZnRIYW5kU2lkZUV4cHJlc3Npb24oKTtcbiAgICByZXR1cm4gdGhpcy5tYXJrTG9jYXRpb24obmV3IFNoaWZ0Lk5ld0V4cHJlc3Npb24oY2FsbGVlLCB0aGlzLm1hdGNoKFRva2VuVHlwZS5MUEFSRU4pID8gdGhpcy5wYXJzZUFyZ3VtZW50TGlzdCgpIDpcbiAgICAgICAgW10pLCBzdGFydFRva2VuSW5kZXgpO1xuICB9XG5cbiAgcGFyc2VQcmltYXJ5RXhwcmVzc2lvbigpIHtcbiAgICBpZiAodGhpcy5tYXRjaChUb2tlblR5cGUuTFBBUkVOKSkge1xuICAgICAgcmV0dXJuIHRoaXMucGFyc2VHcm91cEV4cHJlc3Npb24oKTtcbiAgICB9XG5cbiAgICBsZXQgc3RhcnRUb2tlbkluZGV4ID0gdGhpcy50b2tlbkluZGV4O1xuXG4gICAgc3dpdGNoICh0aGlzLmxvb2thaGVhZC50eXBlLmtsYXNzKSB7XG4gICAgICBjYXNlIFRva2VuQ2xhc3MuSWRlbnQ6XG4gICAgICAgIHJldHVybiB0aGlzLm1hcmtMb2NhdGlvbihuZXcgU2hpZnQuSWRlbnRpZmllckV4cHJlc3Npb24odGhpcy5wYXJzZUlkZW50aWZpZXIoKSksIHN0YXJ0VG9rZW5JbmRleCk7XG4gICAgICBjYXNlIFRva2VuQ2xhc3MuU3RyaW5nTGl0ZXJhbDpcbiAgICAgICAgcmV0dXJuIHRoaXMucGFyc2VTdHJpbmdMaXRlcmFsKCk7XG4gICAgICBjYXNlIFRva2VuQ2xhc3MuTnVtZXJpY0xpdGVyYWw6XG4gICAgICAgIHJldHVybiB0aGlzLnBhcnNlTnVtZXJpY0xpdGVyYWwoKTtcbiAgICAgIGNhc2UgVG9rZW5DbGFzcy5LZXl3b3JkOlxuICAgICAge1xuICAgICAgICBpZiAodGhpcy5tYXRjaChUb2tlblR5cGUuVEhJUykpIHtcbiAgICAgICAgICB0aGlzLmxleCgpO1xuICAgICAgICAgIHJldHVybiB0aGlzLm1hcmtMb2NhdGlvbihuZXcgU2hpZnQuVGhpc0V4cHJlc3Npb24sIHN0YXJ0VG9rZW5JbmRleCk7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKHRoaXMubWF0Y2goVG9rZW5UeXBlLkZVTkNUSU9OKSkge1xuICAgICAgICAgIHJldHVybiB0aGlzLm1hcmtMb2NhdGlvbih0aGlzLnBhcnNlRnVuY3Rpb24odHJ1ZSksIHN0YXJ0VG9rZW5JbmRleCk7XG4gICAgICAgIH1cbiAgICAgICAgYnJlYWs7XG4gICAgICB9XG4gICAgICBjYXNlIFRva2VuQ2xhc3MuQm9vbGVhbkxpdGVyYWw6XG4gICAgICB7XG4gICAgICAgIGxldCB0b2tlbiA9IHRoaXMubGV4KCk7XG4gICAgICAgIHJldHVybiB0aGlzLm1hcmtMb2NhdGlvbihuZXcgU2hpZnQuTGl0ZXJhbEJvb2xlYW5FeHByZXNzaW9uKHRva2VuLnR5cGUgPT0gVG9rZW5UeXBlLlRSVUVfTElURVJBTCksIHN0YXJ0VG9rZW5JbmRleCk7XG4gICAgICB9XG4gICAgICBjYXNlIFRva2VuQ2xhc3MuTnVsbExpdGVyYWw6XG4gICAgICB7XG4gICAgICAgIHRoaXMubGV4KCk7XG4gICAgICAgIHJldHVybiB0aGlzLm1hcmtMb2NhdGlvbihuZXcgU2hpZnQuTGl0ZXJhbE51bGxFeHByZXNzaW9uLCBzdGFydFRva2VuSW5kZXgpO1xuICAgICAgfVxuICAgICAgZGVmYXVsdDpcbiAgICAgICAgaWYgKHRoaXMubWF0Y2goVG9rZW5UeXBlLkxCUkFDSykpIHtcbiAgICAgICAgICByZXR1cm4gdGhpcy5wYXJzZUFycmF5RXhwcmVzc2lvbigpO1xuICAgICAgICB9IGVsc2UgaWYgKHRoaXMubWF0Y2goVG9rZW5UeXBlLkxCUkFDRSkpIHtcbiAgICAgICAgICByZXR1cm4gdGhpcy5wYXJzZU9iamVjdEV4cHJlc3Npb24oKTtcbiAgICAgICAgfSBlbHNlIGlmICh0aGlzLm1hdGNoKFRva2VuVHlwZS5ESVYpIHx8IHRoaXMubWF0Y2goVG9rZW5UeXBlLkFTU0lHTl9ESVYpKSB7XG4gICAgICAgICAgdGhpcy5za2lwQ29tbWVudCgpO1xuICAgICAgICAgIHRoaXMubG9va2FoZWFkID0gdGhpcy5zY2FuUmVnRXhwKCk7XG4gICAgICAgICAgbGV0IHRva2VuID0gdGhpcy5sZXgoKTtcbiAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgbGV0IGxhc3RTbGFzaCA9IHRva2VuLnZhbHVlLmxhc3RJbmRleE9mKFwiL1wiKTtcbiAgICAgICAgICAgIFJlZ0V4cCh0b2tlbi52YWx1ZS5zbGljZSgxLCBsYXN0U2xhc2gpLCB0b2tlbi52YWx1ZS5zbGljZShsYXN0U2xhc2ggKyAxKSk7XG4gICAgICAgICAgfSBjYXRjaCAodW51c2VkKSB7XG4gICAgICAgICAgICB0aHJvdyB0aGlzLmNyZWF0ZUVycm9yV2l0aFRva2VuKHRva2VuLCBFcnJvck1lc3NhZ2VzLklOVkFMSURfUkVHVUxBUl9FWFBSRVNTSU9OKTtcbiAgICAgICAgICB9XG4gICAgICAgICAgcmV0dXJuIHRoaXMubWFya0xvY2F0aW9uKG5ldyBTaGlmdC5MaXRlcmFsUmVnRXhwRXhwcmVzc2lvbih0b2tlbi52YWx1ZSksIHN0YXJ0VG9rZW5JbmRleCk7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICB0aHJvdyB0aGlzLmNyZWF0ZVVuZXhwZWN0ZWQodGhpcy5sZXgoKSk7XG4gIH1cblxuICBwYXJzZU51bWVyaWNMaXRlcmFsKCkge1xuICAgIGxldCBzdGFydFRva2VuSW5kZXggPSB0aGlzLnRva2VuSW5kZXg7XG4gICAgaWYgKHRoaXMuc3RyaWN0ICYmIHRoaXMubG9va2FoZWFkLm9jdGFsKSB7XG4gICAgICB0aHJvdyB0aGlzLmNyZWF0ZUVycm9yV2l0aFRva2VuKHRoaXMubG9va2FoZWFkLCBFcnJvck1lc3NhZ2VzLlNUUklDVF9PQ1RBTF9MSVRFUkFMKTtcbiAgICB9XG4gICAgbGV0IHRva2VuMiA9IHRoaXMubGV4KCk7XG4gICAgbGV0IG5vZGUgPSB0b2tlbjIuX3ZhbHVlID09PSAxLzBcbiAgICAgID8gbmV3IFNoaWZ0LkxpdGVyYWxJbmZpbml0eUV4cHJlc3Npb25cbiAgICAgIDogbmV3IFNoaWZ0LkxpdGVyYWxOdW1lcmljRXhwcmVzc2lvbih0b2tlbjIuX3ZhbHVlKTtcbiAgICByZXR1cm4gdGhpcy5tYXJrTG9jYXRpb24obm9kZSwgc3RhcnRUb2tlbkluZGV4KTtcbiAgfVxuXG4gIHBhcnNlU3RyaW5nTGl0ZXJhbCgpIHtcbiAgICBsZXQgc3RhcnRUb2tlbkluZGV4ID0gdGhpcy50b2tlbkluZGV4O1xuICAgIGlmICh0aGlzLnN0cmljdCAmJiB0aGlzLmxvb2thaGVhZC5vY3RhbCkge1xuICAgICAgdGhyb3cgdGhpcy5jcmVhdGVFcnJvcldpdGhUb2tlbih0aGlzLmxvb2thaGVhZCwgRXJyb3JNZXNzYWdlcy5TVFJJQ1RfT0NUQUxfTElURVJBTCk7XG4gICAgfVxuICAgIGxldCB0b2tlbjIgPSB0aGlzLmxleCgpO1xuICAgIHJldHVybiB0aGlzLm1hcmtMb2NhdGlvbihuZXcgU2hpZnQuTGl0ZXJhbFN0cmluZ0V4cHJlc3Npb24odG9rZW4yLl92YWx1ZSwgdG9rZW4yLnNsaWNlLnRleHQpLFxuICAgICAgICBzdGFydFRva2VuSW5kZXgpO1xuICB9XG5cbiAgcGFyc2VJZGVudGlmaWVyKCkge1xuICAgIGxldCBzdGFydFRva2VuSW5kZXggPSB0aGlzLnRva2VuSW5kZXg7XG4gICAgcmV0dXJuIHRoaXMubWFya0xvY2F0aW9uKG5ldyBTaGlmdC5JZGVudGlmaWVyKHRoaXMubGV4KCkudmFsdWUpLCBzdGFydFRva2VuSW5kZXgpO1xuICB9XG5cbiAgcGFyc2VBcmd1bWVudExpc3QoKSB7XG4gICAgdGhpcy5leHBlY3QoVG9rZW5UeXBlLkxQQVJFTik7XG4gICAgbGV0IGFyZ3MgPSB0aGlzLnBhcnNlQXJndW1lbnRzKCk7XG4gICAgdGhpcy5leHBlY3QoVG9rZW5UeXBlLlJQQVJFTik7XG4gICAgcmV0dXJuIGFyZ3M7XG4gIH1cblxuICBwYXJzZUFyZ3VtZW50cygpIHtcbiAgICBsZXQgcmVzdWx0ID0gW107XG4gICAgd2hpbGUgKHRydWUpIHtcbiAgICAgIGlmICh0aGlzLm1hdGNoKFRva2VuVHlwZS5SUEFSRU4pIHx8IHRoaXMuZW9mKCkpIHtcbiAgICAgICAgcmV0dXJuIHJlc3VsdDtcbiAgICAgIH1cbiAgICAgIGxldCBhcmcgPSB0aGlzLnBhcnNlQXNzaWdubWVudEV4cHJlc3Npb24oKVswXTtcbiAgICAgIHJlc3VsdC5wdXNoKGFyZyk7XG4gICAgICBpZiAoIXRoaXMuZWF0KFRva2VuVHlwZS5DT01NQSkpIHtcbiAgICAgICAgYnJlYWs7XG4gICAgICB9XG4gICAgfVxuICAgIHJldHVybiByZXN1bHQ7XG4gIH1cblxuICAvLyAxMS4yIExlZnQtSGFuZC1TaWRlIEV4cHJlc3Npb25zO1xuXG4gIHBhcnNlTm9uQ29tcHV0ZWRQcm9wZXJ0eSgpIHtcbiAgICBsZXQgc3RhcnRUb2tlbkluZGV4ID0gdGhpcy50b2tlbkluZGV4O1xuXG4gICAgbGV0IHRva2VuID0gdGhpcy5sZXgoKTtcblxuICAgIGlmICghKHRva2VuIGluc3RhbmNlb2YgSWRlbnRpZmllckxpa2VUb2tlbikpIHtcbiAgICAgIHRocm93IHRoaXMuY3JlYXRlVW5leHBlY3RlZCh0b2tlbik7XG4gICAgfSBlbHNlIHtcbiAgICAgIHJldHVybiB0aGlzLm1hcmtMb2NhdGlvbihuZXcgU2hpZnQuSWRlbnRpZmllcih0b2tlbi52YWx1ZSksIHN0YXJ0VG9rZW5JbmRleCk7XG4gICAgfVxuICB9XG5cbiAgcGFyc2VHcm91cEV4cHJlc3Npb24oKSB7XG4gICAgdGhpcy5leHBlY3QoVG9rZW5UeXBlLkxQQVJFTik7XG4gICAgbGV0IGV4cHIgPSB0aGlzLnBhcnNlRXhwcmVzc2lvbigpWzBdO1xuICAgIHRoaXMuZXhwZWN0KFRva2VuVHlwZS5SUEFSRU4pO1xuICAgIHJldHVybiBleHByO1xuICB9XG5cblxuICBwYXJzZUFycmF5RXhwcmVzc2lvbigpIHtcbiAgICBsZXQgc3RhcnRUb2tlbkluZGV4ID0gdGhpcy50b2tlbkluZGV4O1xuXG4gICAgdGhpcy5leHBlY3QoVG9rZW5UeXBlLkxCUkFDSyk7XG5cbiAgICBsZXQgZWxlbWVudHMgPSB0aGlzLnBhcnNlQXJyYXlFeHByZXNzaW9uRWxlbWVudHMoKTtcblxuICAgIHRoaXMuZXhwZWN0KFRva2VuVHlwZS5SQlJBQ0spO1xuXG4gICAgcmV0dXJuIHRoaXMubWFya0xvY2F0aW9uKG5ldyBTaGlmdC5BcnJheUV4cHJlc3Npb24oZWxlbWVudHMpLCBzdGFydFRva2VuSW5kZXgpO1xuICB9XG5cbiAgcGFyc2VBcnJheUV4cHJlc3Npb25FbGVtZW50cygpIHtcbiAgICBsZXQgcmVzdWx0ID0gW107XG4gICAgd2hpbGUgKHRydWUpIHtcbiAgICAgIGlmICh0aGlzLm1hdGNoKFRva2VuVHlwZS5SQlJBQ0spKSB7XG4gICAgICAgIHJldHVybiByZXN1bHQ7XG4gICAgICB9XG4gICAgICBsZXQgZWw7XG5cbiAgICAgIGlmICh0aGlzLm1hdGNoKFRva2VuVHlwZS5DT01NQSkpIHtcbiAgICAgICAgdGhpcy5sZXgoKTtcbiAgICAgICAgZWwgPSBudWxsO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgZWwgPSB0aGlzLnBhcnNlQXNzaWdubWVudEV4cHJlc3Npb24oKVswXTtcbiAgICAgICAgaWYgKCF0aGlzLm1hdGNoKFRva2VuVHlwZS5SQlJBQ0spKSB7XG4gICAgICAgICAgdGhpcy5leHBlY3QoVG9rZW5UeXBlLkNPTU1BKTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgICAgcmVzdWx0LnB1c2goZWwpO1xuICAgIH1cbiAgfVxuXG4gIHBhcnNlT2JqZWN0RXhwcmVzc2lvbigpIHtcbiAgICBsZXQgc3RhcnRUb2tlbkluZGV4ID0gdGhpcy50b2tlbkluZGV4O1xuXG4gICAgdGhpcy5leHBlY3QoVG9rZW5UeXBlLkxCUkFDRSk7XG5cbiAgICBsZXQgcHJvcGVydHlNYXAgPSBPYmplY3QuY3JlYXRlKG51bGwpO1xuICAgIGxldCBwcm9wZXJ0aWVzID0gdGhpcy5wYXJzZU9iamVjdEV4cHJlc3Npb25JdGVtcyhwcm9wZXJ0eU1hcCk7XG5cbiAgICB0aGlzLmV4cGVjdChUb2tlblR5cGUuUkJSQUNFKTtcblxuICAgIHJldHVybiB0aGlzLm1hcmtMb2NhdGlvbihuZXcgU2hpZnQuT2JqZWN0RXhwcmVzc2lvbihwcm9wZXJ0aWVzKSwgc3RhcnRUb2tlbkluZGV4KTtcbiAgfVxuXG5cbiAgcGFyc2VPYmplY3RFeHByZXNzaW9uSXRlbXMocHJvcGVydHlNYXApIHtcbiAgICBsZXQgcmVzdWx0ID0gW107XG4gICAgd2hpbGUgKCF0aGlzLm1hdGNoKFRva2VuVHlwZS5SQlJBQ0UpKSB7XG4gICAgICByZXN1bHQucHVzaCh0aGlzLnBhcnNlT2JqZWN0RXhwcmVzc2lvbkl0ZW0ocHJvcGVydHlNYXApKTtcbiAgICB9XG4gICAgcmV0dXJuIHJlc3VsdDtcbiAgfVxuXG4gIHBhcnNlT2JqZWN0RXhwcmVzc2lvbkl0ZW0ocHJvcGVydHlNYXApIHtcbiAgICBsZXQgcHJvcGVydHkgPSB0aGlzLnBhcnNlT2JqZWN0UHJvcGVydHkoKTtcbiAgICBsZXQgdHlwZSA9IHByb3BlcnR5LnR5cGU7XG4gICAgbGV0IGtleSA9IFwiJFwiICsgcHJvcGVydHkubmFtZS52YWx1ZTtcbiAgICBsZXQgdmFsdWUgPSB7fS5oYXNPd25Qcm9wZXJ0eS5jYWxsKHByb3BlcnR5TWFwLCBrZXkpID8gcHJvcGVydHlNYXBba2V5XSA6IDA7XG5cbiAgICBpZiAoe30uaGFzT3duUHJvcGVydHkuY2FsbChwcm9wZXJ0eU1hcCwga2V5KSkge1xuICAgICAgaWYgKCh2YWx1ZSAmIElOSVRfTUFTSykgIT09IDApIHtcbiAgICAgICAgaWYgKHRoaXMuc3RyaWN0ICYmIHR5cGUgPT09IFwiRGF0YVByb3BlcnR5XCIpIHtcbiAgICAgICAgICB0aHJvdyB0aGlzLmNyZWF0ZUVycm9yKEVycm9yTWVzc2FnZXMuU1RSSUNUX0RVUExJQ0FURV9QUk9QRVJUWSk7XG4gICAgICAgIH0gZWxzZSBpZiAodHlwZSAhPT0gXCJEYXRhUHJvcGVydHlcIikge1xuICAgICAgICAgIHRocm93IHRoaXMuY3JlYXRlRXJyb3IoRXJyb3JNZXNzYWdlcy5BQ0NFU1NPUl9EQVRBX1BST1BFUlRZKTtcbiAgICAgICAgfVxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgaWYgKHR5cGUgPT09IFwiRGF0YVByb3BlcnR5XCIpIHtcbiAgICAgICAgICB0aHJvdyB0aGlzLmNyZWF0ZUVycm9yKEVycm9yTWVzc2FnZXMuQUNDRVNTT1JfREFUQV9QUk9QRVJUWSk7XG4gICAgICAgIH0gZWxzZSBpZiAoKHZhbHVlICYgR0VUVEVSX01BU0spICE9PSAwICYmIHR5cGUgPT0gXCJHZXR0ZXJcIlxuICAgICAgICAgICAgfHwgKHZhbHVlICYgU0VUVEVSX01BU0spICE9PSAwICYmIHR5cGUgPT0gXCJTZXR0ZXJcIikge1xuICAgICAgICAgIHRocm93IHRoaXMuY3JlYXRlRXJyb3IoRXJyb3JNZXNzYWdlcy5BQ0NFU1NPUl9HRVRfU0VUKTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH1cbiAgICBzd2l0Y2ggKHR5cGUpIHtcbiAgICAgIGNhc2UgXCJEYXRhUHJvcGVydHlcIjpcbiAgICAgICAgcHJvcGVydHlNYXBba2V5XSA9IHZhbHVlIHwgSU5JVF9NQVNLO1xuICAgICAgICBicmVhaztcbiAgICAgIGNhc2UgXCJHZXR0ZXJcIjpcbiAgICAgICAgcHJvcGVydHlNYXBba2V5XSA9IHZhbHVlIHwgR0VUVEVSX01BU0s7XG4gICAgICAgIGJyZWFrO1xuICAgICAgY2FzZSBcIlNldHRlclwiOlxuICAgICAgICBwcm9wZXJ0eU1hcFtrZXldID0gdmFsdWUgfCBTRVRURVJfTUFTSztcbiAgICAgICAgYnJlYWs7XG4gICAgfVxuXG4gICAgaWYgKCF0aGlzLm1hdGNoKFRva2VuVHlwZS5SQlJBQ0UpKSB7XG4gICAgICB0aGlzLmV4cGVjdChUb2tlblR5cGUuQ09NTUEpO1xuICAgIH1cbiAgICByZXR1cm4gcHJvcGVydHk7XG4gIH1cblxuICBwYXJzZU9iamVjdFByb3BlcnR5S2V5KCkge1xuICAgIGxldCB0b2tlbiA9IHRoaXMubG9va2FoZWFkO1xuXG4gICAgLy8gTm90ZTogVGhpcyBmdW5jdGlvbiBpcyBjYWxsZWQgb25seSBmcm9tIHBhcnNlT2JqZWN0UHJvcGVydHkoKSwgd2hlcmU7XG4gICAgLy8gRW9mIGFuZCBQdW5jdHVhdG9yIHRva2VucyBhcmUgYWxyZWFkeSBmaWx0ZXJlZCBvdXQuXG5cbiAgICBpZiAodG9rZW4gaW5zdGFuY2VvZiBTdHJpbmdMaXRlcmFsVG9rZW4pIHtcbiAgICAgIHJldHVybiBuZXcgU2hpZnQuUHJvcGVydHlOYW1lKFwic3RyaW5nXCIsIHRoaXMucGFyc2VTdHJpbmdMaXRlcmFsKCkudmFsdWUpO1xuICAgIH1cbiAgICBpZiAodG9rZW4gaW5zdGFuY2VvZiBOdW1lcmljTGl0ZXJhbFRva2VuKSB7XG4gICAgICBsZXQgbnVtTGl0ZXJhbCA9IHRoaXMucGFyc2VOdW1lcmljTGl0ZXJhbCgpO1xuICAgICAgcmV0dXJuIG5ldyBTaGlmdC5Qcm9wZXJ0eU5hbWUoXCJudW1iZXJcIiwgXCJcIiArIChudW1MaXRlcmFsLnR5cGUgPT09IFwiTGl0ZXJhbEluZmluaXR5RXhwcmVzc2lvblwiID8gMSAvIDAgOiBudW1MaXRlcmFsLnZhbHVlKSk7XG4gICAgfVxuICAgIGlmICh0b2tlbiBpbnN0YW5jZW9mIElkZW50aWZpZXJMaWtlVG9rZW4pIHtcbiAgICAgIHJldHVybiBuZXcgU2hpZnQuUHJvcGVydHlOYW1lKFwiaWRlbnRpZmllclwiLCB0aGlzLnBhcnNlSWRlbnRpZmllcigpLm5hbWUpO1xuICAgIH1cblxuICAgIHRocm93IHRoaXMuY3JlYXRlRXJyb3IoRXJyb3JNZXNzYWdlcy5JTlZBTElEX1BST1BFUlRZX05BTUUpO1xuICB9XG5cbiAgcGFyc2VPYmplY3RQcm9wZXJ0eSgpIHtcbiAgICBsZXQgdG9rZW4gPSB0aGlzLmxvb2thaGVhZDtcbiAgICBsZXQgc3RhcnRUb2tlbkluZGV4ID0gdGhpcy50b2tlbkluZGV4O1xuXG4gICAgaWYgKHRva2VuLnR5cGUgPT09IFRva2VuVHlwZS5JREVOVElGSUVSKSB7XG4gICAgICBsZXQga2V5ID0gdGhpcy5wYXJzZU9iamVjdFByb3BlcnR5S2V5KCk7XG4gICAgICBsZXQgbmFtZSA9IHRva2VuLnZhbHVlO1xuICAgICAgaWYgKG5hbWUubGVuZ3RoID09PSAzKSB7XG4gICAgICAgIC8vIFByb3BlcnR5IEFzc2lnbm1lbnQ6IEdldHRlciBhbmQgU2V0dGVyLlxuICAgICAgICBpZiAoXCJnZXRcIiA9PT0gbmFtZSAmJiAhdGhpcy5tYXRjaChUb2tlblR5cGUuQ09MT04pKSB7XG4gICAgICAgICAga2V5ID0gdGhpcy5wYXJzZU9iamVjdFByb3BlcnR5S2V5KCk7XG4gICAgICAgICAgdGhpcy5leHBlY3QoVG9rZW5UeXBlLkxQQVJFTik7XG4gICAgICAgICAgdGhpcy5leHBlY3QoVG9rZW5UeXBlLlJQQVJFTik7XG4gICAgICAgICAgbGV0IFtib2R5LCBpc1N0cmljdF0gPSB0aGlzLnBhcnNlRnVuY3Rpb25Cb2R5KCk7XG4gICAgICAgICAgcmV0dXJuIHRoaXMubWFya0xvY2F0aW9uKG5ldyBTaGlmdC5HZXR0ZXIoa2V5LCBib2R5KSwgc3RhcnRUb2tlbkluZGV4KTtcbiAgICAgICAgfSBlbHNlIGlmIChcInNldFwiID09PSBuYW1lICYmICF0aGlzLm1hdGNoKFRva2VuVHlwZS5DT0xPTikpIHtcbiAgICAgICAgICBrZXkgPSB0aGlzLnBhcnNlT2JqZWN0UHJvcGVydHlLZXkoKTtcbiAgICAgICAgICB0aGlzLmV4cGVjdChUb2tlblR5cGUuTFBBUkVOKTtcbiAgICAgICAgICB0b2tlbiA9IHRoaXMubG9va2FoZWFkO1xuICAgICAgICAgIGlmICh0b2tlbi50eXBlICE9PSBUb2tlblR5cGUuSURFTlRJRklFUikge1xuICAgICAgICAgICAgdGhpcy5leHBlY3QoVG9rZW5UeXBlLlJQQVJFTik7XG4gICAgICAgICAgICB0aHJvdyB0aGlzLmNyZWF0ZUVycm9yV2l0aFRva2VuKHRva2VuLCBFcnJvck1lc3NhZ2VzLlVORVhQRUNURURfVE9LRU4sIHRva2VuLnR5cGUubmFtZSk7XG4gICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIGxldCBwYXJhbSA9IHRoaXMucGFyc2VWYXJpYWJsZUlkZW50aWZpZXIoKTtcbiAgICAgICAgICAgIHRoaXMuZXhwZWN0KFRva2VuVHlwZS5SUEFSRU4pO1xuICAgICAgICAgICAgbGV0IFtib2R5LCBpc1N0cmljdF0gPSB0aGlzLnBhcnNlRnVuY3Rpb25Cb2R5KCk7XG4gICAgICAgICAgICBpZiAoKHRoaXMuc3RyaWN0IHx8IGlzU3RyaWN0KSAmJiBpc1Jlc3RyaWN0ZWRXb3JkKHBhcmFtLm5hbWUpKSB7XG4gICAgICAgICAgICAgIHRocm93IHRoaXMuY3JlYXRlRXJyb3IoRXJyb3JNZXNzYWdlcy5TVFJJQ1RfUEFSQU1fTkFNRSk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICByZXR1cm4gdGhpcy5tYXJrTG9jYXRpb24obmV3IFNoaWZ0LlNldHRlcihrZXksIHBhcmFtLCBib2R5KSwgc3RhcnRUb2tlbkluZGV4KTtcbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgIH1cblxuICAgICAgdGhpcy5leHBlY3QoVG9rZW5UeXBlLkNPTE9OKTtcbiAgICAgIGxldCB2YWx1ZSA9IHRoaXMucGFyc2VBc3NpZ25tZW50RXhwcmVzc2lvbigpWzBdO1xuICAgICAgcmV0dXJuIHRoaXMubWFya0xvY2F0aW9uKG5ldyBTaGlmdC5EYXRhUHJvcGVydHkoa2V5LCB2YWx1ZSksIHN0YXJ0VG9rZW5JbmRleCk7XG4gICAgfVxuICAgIGlmICh0aGlzLmVvZigpIHx8IHRva2VuLnR5cGUua2xhc3MgPT0gVG9rZW5DbGFzcy5QdW5jdHVhdG9yKSB7XG4gICAgICB0aHJvdyB0aGlzLmNyZWF0ZVVuZXhwZWN0ZWQodG9rZW4pO1xuICAgIH0gZWxzZSB7XG4gICAgICBsZXQga2V5ID0gdGhpcy5wYXJzZU9iamVjdFByb3BlcnR5S2V5KCk7XG4gICAgICB0aGlzLmV4cGVjdChUb2tlblR5cGUuQ09MT04pO1xuICAgICAgbGV0IHZhbHVlID0gdGhpcy5wYXJzZUFzc2lnbm1lbnRFeHByZXNzaW9uKClbMF07XG4gICAgICByZXR1cm4gdGhpcy5tYXJrTG9jYXRpb24obmV3IFNoaWZ0LkRhdGFQcm9wZXJ0eShrZXksIHZhbHVlKSwgc3RhcnRUb2tlbkluZGV4KTtcbiAgICB9XG4gIH1cblxuICBwYXJzZUZ1bmN0aW9uKGlzRXhwcmVzc2lvbikge1xuICAgIGxldCBzdGFydFRva2VuSW5kZXggPSB0aGlzLnRva2VuSW5kZXg7XG5cbiAgICB0aGlzLmV4cGVjdChUb2tlblR5cGUuRlVOQ1RJT04pO1xuXG4gICAgbGV0IGlkID0gbnVsbDtcbiAgICBsZXQgbWVzc2FnZSA9IG51bGw7XG4gICAgbGV0IGZpcnN0UmVzdHJpY3RlZCA9IG51bGw7XG4gICAgaWYgKCFpc0V4cHJlc3Npb24gfHwgIXRoaXMubWF0Y2goVG9rZW5UeXBlLkxQQVJFTikpIHtcbiAgICAgIGxldCB0b2tlbiA9IHRoaXMubG9va2FoZWFkO1xuICAgICAgaWQgPSB0aGlzLnBhcnNlVmFyaWFibGVJZGVudGlmaWVyKCk7XG4gICAgICBpZiAodGhpcy5zdHJpY3QpIHtcbiAgICAgICAgaWYgKGlzUmVzdHJpY3RlZFdvcmQoaWQubmFtZSkpIHtcbiAgICAgICAgICB0aHJvdyB0aGlzLmNyZWF0ZUVycm9yV2l0aFRva2VuKHRva2VuLCBFcnJvck1lc3NhZ2VzLlNUUklDVF9GVU5DVElPTl9OQU1FKTtcbiAgICAgICAgfVxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgaWYgKGlzUmVzdHJpY3RlZFdvcmQoaWQubmFtZSkpIHtcbiAgICAgICAgICBmaXJzdFJlc3RyaWN0ZWQgPSB0b2tlbjtcbiAgICAgICAgICBtZXNzYWdlID0gRXJyb3JNZXNzYWdlcy5TVFJJQ1RfRlVOQ1RJT05fTkFNRTtcbiAgICAgICAgfSBlbHNlIGlmIChpc1N0cmljdE1vZGVSZXNlcnZlZFdvcmRFUzUoaWQubmFtZSkpIHtcbiAgICAgICAgICBmaXJzdFJlc3RyaWN0ZWQgPSB0b2tlbjtcbiAgICAgICAgICBtZXNzYWdlID0gRXJyb3JNZXNzYWdlcy5TVFJJQ1RfUkVTRVJWRURfV09SRDtcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH1cbiAgICBsZXQgaW5mbyA9IHRoaXMucGFyc2VQYXJhbXMoZmlyc3RSZXN0cmljdGVkKTtcblxuICAgIGlmIChpbmZvLm1lc3NhZ2UgIT0gbnVsbCkge1xuICAgICAgbWVzc2FnZSA9IGluZm8ubWVzc2FnZTtcbiAgICB9XG5cbiAgICBsZXQgcHJldmlvdXNTdHJpY3QgPSB0aGlzLnN0cmljdDtcbiAgICBsZXQgW2JvZHksIGlzU3RyaWN0XSA9IHRoaXMucGFyc2VGdW5jdGlvbkJvZHkoKTtcbiAgICBpZiAobWVzc2FnZSAhPSBudWxsKSB7XG4gICAgICBpZiAoKHRoaXMuc3RyaWN0IHx8IGlzU3RyaWN0KSAmJiBpbmZvLmZpcnN0UmVzdHJpY3RlZCAhPSBudWxsKSB7XG4gICAgICAgIHRocm93IHRoaXMuY3JlYXRlRXJyb3JXaXRoVG9rZW4oaW5mby5maXJzdFJlc3RyaWN0ZWQsIG1lc3NhZ2UpO1xuICAgICAgfVxuICAgICAgaWYgKCh0aGlzLnN0cmljdCB8fCBpc1N0cmljdCkgJiYgaW5mby5zdHJpY3RlZCAhPSBudWxsKSB7XG4gICAgICAgIHRocm93IHRoaXMuY3JlYXRlRXJyb3JXaXRoVG9rZW4oaW5mby5zdHJpY3RlZCwgbWVzc2FnZSk7XG4gICAgICB9XG4gICAgfVxuICAgIHRoaXMuc3RyaWN0ID0gcHJldmlvdXNTdHJpY3Q7XG4gICAgcmV0dXJuIHRoaXMubWFya0xvY2F0aW9uKG5ldyAoaXNFeHByZXNzaW9uID8gU2hpZnQuRnVuY3Rpb25FeHByZXNzaW9uIDogU2hpZnQuRnVuY3Rpb25EZWNsYXJhdGlvbikoaWQsIGluZm8ucGFyYW1zLCBib2R5KSxcbiAgICAgICAgc3RhcnRUb2tlbkluZGV4KTtcbiAgfVxuXG5cbiAgcGFyc2VQYXJhbXMoZnIpIHtcbiAgICBsZXQgaW5mbyA9IHtwYXJhbXM6IFtdfTtcbiAgICBpbmZvLmZpcnN0UmVzdHJpY3RlZCA9IGZyO1xuICAgIHRoaXMuZXhwZWN0KFRva2VuVHlwZS5MUEFSRU4pO1xuXG4gICAgaWYgKCF0aGlzLm1hdGNoKFRva2VuVHlwZS5SUEFSRU4pKSB7XG4gICAgICBsZXQgcGFyYW1TZXQgPSBPYmplY3QuY3JlYXRlKG51bGwpO1xuXG4gICAgICB3aGlsZSAoIXRoaXMuZW9mKCkpIHtcbiAgICAgICAgbGV0IHRva2VuID0gdGhpcy5sb29rYWhlYWQ7XG4gICAgICAgIGxldCBwYXJhbSA9IHRoaXMucGFyc2VWYXJpYWJsZUlkZW50aWZpZXIoKTtcbiAgICAgICAgbGV0IGtleSA9IFwiJFwiICsgcGFyYW0ubmFtZTtcbiAgICAgICAgaWYgKHRoaXMuc3RyaWN0KSB7XG4gICAgICAgICAgaWYgKHRva2VuIGluc3RhbmNlb2YgSWRlbnRpZmllckxpa2VUb2tlbiAmJiBpc1Jlc3RyaWN0ZWRXb3JkKHBhcmFtLm5hbWUpKSB7XG4gICAgICAgICAgICBpbmZvLnN0cmljdGVkID0gdG9rZW47XG4gICAgICAgICAgICBpbmZvLm1lc3NhZ2UgPSBFcnJvck1lc3NhZ2VzLlNUUklDVF9QQVJBTV9OQU1FO1xuICAgICAgICAgIH1cbiAgICAgICAgICBpZiAoe30uaGFzT3duUHJvcGVydHkuY2FsbChwYXJhbVNldCwga2V5KSkge1xuICAgICAgICAgICAgaW5mby5zdHJpY3RlZCA9IHRva2VuO1xuICAgICAgICAgICAgaW5mby5tZXNzYWdlID0gRXJyb3JNZXNzYWdlcy5TVFJJQ1RfUEFSQU1fRFVQRTtcbiAgICAgICAgICB9XG4gICAgICAgIH0gZWxzZSBpZiAoaW5mby5maXJzdFJlc3RyaWN0ZWQgPT0gbnVsbCkge1xuICAgICAgICAgIGlmICh0b2tlbiBpbnN0YW5jZW9mIElkZW50aWZpZXJMaWtlVG9rZW4gJiYgaXNSZXN0cmljdGVkV29yZChwYXJhbS5uYW1lKSkge1xuICAgICAgICAgICAgaW5mby5maXJzdFJlc3RyaWN0ZWQgPSB0b2tlbjtcbiAgICAgICAgICAgIGluZm8ubWVzc2FnZSA9IEVycm9yTWVzc2FnZXMuU1RSSUNUX1BBUkFNX05BTUU7XG4gICAgICAgICAgfSBlbHNlIGlmIChTVFJJQ1RfTU9ERV9SRVNFUlZFRF9XT1JELmluZGV4T2YocGFyYW0ubmFtZSkgIT09IC0xKSB7XG4gICAgICAgICAgICBpbmZvLmZpcnN0UmVzdHJpY3RlZCA9IHRva2VuO1xuICAgICAgICAgICAgaW5mby5tZXNzYWdlID0gRXJyb3JNZXNzYWdlcy5TVFJJQ1RfUkVTRVJWRURfV09SRDtcbiAgICAgICAgICB9IGVsc2UgaWYgKHt9Lmhhc093blByb3BlcnR5LmNhbGwocGFyYW1TZXQsIGtleSkpIHtcbiAgICAgICAgICAgIGluZm8uZmlyc3RSZXN0cmljdGVkID0gdG9rZW47XG4gICAgICAgICAgICBpbmZvLm1lc3NhZ2UgPSBFcnJvck1lc3NhZ2VzLlNUUklDVF9QQVJBTV9EVVBFO1xuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgICBpbmZvLnBhcmFtcy5wdXNoKHBhcmFtKTtcbiAgICAgICAgcGFyYW1TZXRba2V5XSA9IHRydWU7XG4gICAgICAgIGlmICh0aGlzLm1hdGNoKFRva2VuVHlwZS5SUEFSRU4pKSB7XG4gICAgICAgICAgYnJlYWs7XG4gICAgICAgIH1cbiAgICAgICAgdGhpcy5leHBlY3QoVG9rZW5UeXBlLkNPTU1BKTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICB0aGlzLmV4cGVjdChUb2tlblR5cGUuUlBBUkVOKTtcbiAgICByZXR1cm4gaW5mbztcbiAgfVxuXG5cbn1cbiJdfQ==