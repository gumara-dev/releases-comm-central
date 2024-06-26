"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.ValueFormatter = void 0;
/*
Copyright 2023 The Matrix.org Foundation C.I.C.
Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at
    http://www.apache.org/licenses/LICENSE-2.0
Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/
class ValueFormatter {
  static getNonNegativeValue(imput) {
    let value = imput;
    if (typeof value !== "number") {
      value = Number(value);
    }
    if (isNaN(value)) {
      return 0;
    }
    return Math.max(0, value);
  }
}
exports.ValueFormatter = ValueFormatter;