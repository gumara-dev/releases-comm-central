/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

var gIdentity = null;

window.addEventListener("load", onLoadArchiveOptions);
document.addEventListener("dialogaccept", onAcceptArchiveOptions);

/**
 * Load the archive options dialog, set the radio/checkbox items to the
 * appropriate values, and update the archive hierarchy example.
 */
function onLoadArchiveOptions() {
  // extract the account
  gIdentity = window.arguments[0].identity;

  const granularity = document.getElementById("archiveGranularity");
  granularity.selectedIndex = gIdentity.archiveGranularity;
  granularity.addEventListener("command", updateArchiveExample);

  const kfs = document.getElementById("archiveKeepFolderStructure");
  kfs.checked = gIdentity.archiveKeepFolderStructure;
  kfs.addEventListener("command", updateArchiveExample);

  updateArchiveExample();
}

/**
 * Save the archive settings to the current identity.
 */
function onAcceptArchiveOptions() {
  gIdentity.archiveGranularity =
    document.getElementById("archiveGranularity").selectedIndex;
  gIdentity.archiveKeepFolderStructure = document.getElementById(
    "archiveKeepFolderStructure"
  ).checked;
}

/**
 * Update the example tree to show what the current options would look like.
 */
function updateArchiveExample() {
  const granularity =
    document.getElementById("archiveGranularity").selectedIndex;
  const kfs = document.getElementById("archiveKeepFolderStructure").checked;
  const hierarchy = [
    document.getElementsByClassName("root"),
    document.getElementsByClassName("year"),
    document.getElementsByClassName("month"),
  ];

  // First, show/hide the appropriate levels in the hierarchy and turn the
  // necessary items into containers.
  for (let i = 0; i < hierarchy.length; i++) {
    for (let j = 0; j < hierarchy[i].length; j++) {
      hierarchy[i][j].setAttribute("container", granularity > i);
      hierarchy[i][j].setAttribute("open", granularity > i);
      hierarchy[i][j].hidden = granularity < i;
    }
  }

  // Next, handle the "keep folder structures" case by moving a tree item around
  // and making sure its parent is a container.
  const folders = document.getElementById("folders");
  folders.hidden = !kfs;
  if (kfs) {
    const parent = hierarchy[granularity][0];
    parent.setAttribute("container", true);
    parent.setAttribute("open", true);

    const treechildren = parent.children[1];
    treechildren.appendChild(folders);
  }
}
