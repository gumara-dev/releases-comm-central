/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

ChromeUtils.import("resource://gre/modules/Services.jsm");

for (let script of [
  "chrome://messenger/content/mailWidgets.js",
]) {
  Services.scriptloader.loadSubScript(script, window);
}
