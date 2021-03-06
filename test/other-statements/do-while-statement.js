/**
 * Copyright 2014 Shape Security, Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License")
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

var testEsprimaEquiv = require('../assertions').testEsprimaEquiv;

suite("Parser", function () {
  suite("do while statement", function () {
    testEsprimaEquiv("do keep(); while (true)");
    testEsprimaEquiv("do keep(); while (true);");
    testEsprimaEquiv("do { x++; y--; } while (x < 10)");
    testEsprimaEquiv("{ do { } while (false) false }");
    testEsprimaEquiv("do continue; while(1);");
  });
});
