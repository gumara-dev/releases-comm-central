"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.getHttpUriForMxc = getHttpUriForMxc;
var _utils = require("./utils");
/*
Copyright 2015 - 2021 The Matrix.org Foundation C.I.C.

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

/**
 * Get the HTTP URL for an MXC URI.
 * @param baseUrl - The base homeserver url which has a content repo.
 * @param mxc - The mxc:// URI.
 * @param width - The desired width of the thumbnail.
 * @param height - The desired height of the thumbnail.
 * @param resizeMethod - The thumbnail resize method to use, either
 * "crop" or "scale".
 * @param allowDirectLinks - If true, return any non-mxc URLs
 * directly. Fetching such URLs will leak information about the user to
 * anyone they share a room with. If false, will return the emptry string
 * for such URLs.
 * @param allowRedirects - If true, the caller supports the URL being 307 or
 * 308 redirected to another resource upon request. If false, redirects
 * are not expected.
 * @returns The complete URL to the content.
 */
function getHttpUriForMxc(baseUrl, mxc, width, height, resizeMethod, allowDirectLinks = false, allowRedirects) {
  if (typeof mxc !== "string" || !mxc) {
    return "";
  }
  if (mxc.indexOf("mxc://") !== 0) {
    if (allowDirectLinks) {
      return mxc;
    } else {
      return "";
    }
  }
  let serverAndMediaId = mxc.slice(6); // strips mxc://
  let prefix = "/_matrix/media/v3/download/";
  const params = {};
  if (width) {
    params["width"] = Math.round(width).toString();
  }
  if (height) {
    params["height"] = Math.round(height).toString();
  }
  if (resizeMethod) {
    params["method"] = resizeMethod;
  }
  if (Object.keys(params).length > 0) {
    // these are thumbnailing params so they probably want the
    // thumbnailing API...
    prefix = "/_matrix/media/v3/thumbnail/";
  }
  if (typeof allowRedirects === "boolean") {
    // We add this after, so we don't convert everything to a thumbnail request.
    params["allow_redirect"] = JSON.stringify(allowRedirects);
  }
  const fragmentOffset = serverAndMediaId.indexOf("#");
  let fragment = "";
  if (fragmentOffset >= 0) {
    fragment = serverAndMediaId.slice(fragmentOffset);
    serverAndMediaId = serverAndMediaId.slice(0, fragmentOffset);
  }
  const urlParams = Object.keys(params).length === 0 ? "" : "?" + (0, _utils.encodeParams)(params);
  return baseUrl + prefix + serverAndMediaId + urlParams + fragment;
}