/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, you can obtain one at http://mozilla.org/MPL/2.0/. */

add_task(async function test_f6_cycle() {
  function cycle(...ids) {
    Assert.equal(abDocument.activeElement.id, ids[0]);
    for (let i = 1; i < ids.length; i++) {
      EventUtils.synthesizeKey("KEY_F6", {}, abWindow);
      Assert.equal(abDocument.activeElement.id, ids[i], "F6 moved the focus");
    }
    for (let i = ids.length - 2; i >= 0; i--) {
      EventUtils.synthesizeKey("KEY_F6", { shiftKey: true }, abWindow);
      Assert.equal(
        abDocument.activeElement.id,
        ids[i],
        "Shift+F6 moved the focus"
      );
    }
  }

  let book = createAddressBook("Test Book");
  book.addCard(createContact("contact", "1"));

  let abWindow = await openAddressBookWindow();

  let abDocument = abWindow.document;
  let cardsList = abDocument.getElementById("cards");
  let detailsPane = abDocument.getElementById("detailsPane");

  let editButton = abDocument.getElementById("editButton");

  Assert.ok(BrowserTestUtils.is_hidden(detailsPane));

  // Check what happens with no contact selected.

  cycle("searchInput", "cards", "books", "searchInput");

  // Check what happens with a contact selected.

  openDirectory(book);
  EventUtils.synthesizeMouseAtCenter(cardsList.getRowAtIndex(0), {}, abWindow);
  Assert.ok(BrowserTestUtils.is_visible(detailsPane));

  cycle("cards", "editButton", "books", "searchInput", "cards");

  // Check what happens while editing. It should be nothing.

  EventUtils.synthesizeMouseAtCenter(editButton, {}, abWindow);
  Assert.equal(abDocument.activeElement.id, "vcard-n-firstname");
  EventUtils.synthesizeKey("KEY_F6", {}, abWindow);
  Assert.equal(
    abDocument.activeElement.id,
    "vcard-n-firstname",
    "F6 did nothing"
  );
  EventUtils.synthesizeKey("KEY_F6", { shiftKey: true }, abWindow);
  Assert.equal(
    abDocument.activeElement.id,
    "vcard-n-firstname",
    "Shift+F6 did nothing"
  );

  await closeAddressBookWindow();
  await promiseDirectoryRemoved(book.URI);
});
