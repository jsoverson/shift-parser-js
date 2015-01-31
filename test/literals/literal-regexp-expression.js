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

describe("Parser", function () {
  describe("literal regexp expression", function () {
    // Regular Expression Literals
    testEsprimaEquiv("/a/");
    testEsprimaEquiv("/a/;");
    testEsprimaEquiv("/a/i");
    testEsprimaEquiv("/a/i;");
    testEsprimaEquiv("/[a-z]/i");
    testEsprimaEquiv("/[x-z]/i");
    testEsprimaEquiv("/[a-c]/i");
    testEsprimaEquiv("/[P QR]/i");
    testEsprimaEquiv("/[\\]/]/");
    testEsprimaEquiv("/foo\\/bar/");
    testEsprimaEquiv("/=([^=\\s])+/g");
    // testEsprimaEquiv("/[P QR]/\\g");
    testEsprimaEquiv("/42/g.test");
  });
});
