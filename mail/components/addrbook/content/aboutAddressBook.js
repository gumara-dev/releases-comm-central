/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, you can obtain one at http://mozilla.org/MPL/2.0/. */

/* globals ABView */

var { MailServices } = ChromeUtils.import(
  "resource:///modules/MailServices.jsm"
);
var { AppConstants } = ChromeUtils.import(
  "resource://gre/modules/AppConstants.jsm"
);
var { Services } = ChromeUtils.import("resource://gre/modules/Services.jsm");
var { UIDensity } = ChromeUtils.import("resource:///modules/UIDensity.jsm");
var { UIFontSize } = ChromeUtils.import("resource:///modules/UIFontSize.jsm");
var { XPCOMUtils } = ChromeUtils.import(
  "resource://gre/modules/XPCOMUtils.jsm"
);

XPCOMUtils.defineLazyGetter(this, "ABQueryUtils", function() {
  return ChromeUtils.import("resource:///modules/ABQueryUtils.jsm");
});
XPCOMUtils.defineLazyGetter(this, "AddrBookUtils", function() {
  return ChromeUtils.import("resource:///modules/AddrBookUtils.jsm");
});
XPCOMUtils.defineLazyModuleGetters(this, {
  AddrBookCard: "resource:///modules/AddrBookCard.jsm",
  AddrBookUtils: "resource:///modules/AddrBookUtils.jsm",
  cal: "resource:///modules/calendar/calUtils.jsm",
  CalAttendee: "resource:///modules/CalAttendee.jsm",
  CalMetronome: "resource:///modules/CalMetronome.jsm",
  CardDAVDirectory: "resource:///modules/CardDAVDirectory.jsm",
  FileUtils: "resource://gre/modules/FileUtils.jsm",
  GlodaMsgSearcher: "resource:///modules/gloda/GlodaMsgSearcher.jsm",
  ICAL: "resource:///modules/calendar/Ical.jsm",
  MailE10SUtils: "resource:///modules/MailE10SUtils.jsm",
  PluralForm: "resource://gre/modules/PluralForm.jsm",
  VCardProperties: "resource:///modules/VCardUtils.jsm",
  VCardPropertyEntry: "resource:///modules/VCardUtils.jsm",
});
XPCOMUtils.defineLazyGetter(this, "SubDialog", function() {
  const { SubDialogManager } = ChromeUtils.import(
    "resource://gre/modules/SubDialog.jsm"
  );
  return new SubDialogManager({
    dialogStack: document.getElementById("dialogStack"),
    dialogTemplate: document.getElementById("dialogTemplate"),
    dialogOptions: {
      styleSheets: [
        "chrome://messenger/skin/preferences/dialog.css",
        "chrome://messenger/skin/shared/preferences/subdialog.css",
        "chrome://messenger/skin/abFormFields.css",
      ],
      resizeCallback: ({ title, frame }) => {
        UIFontSize.registerWindow(frame.contentWindow);
      },
    },
  });
});

UIDensity.registerWindow(window);
UIFontSize.registerWindow(window);

var booksList;

window.addEventListener("load", () => {
  document
    .getElementById("toolbarCreateBook")
    .addEventListener("command", event => {
      let type = event.target.value || "JS_DIRECTORY_TYPE";
      createBook(Ci.nsIAbManager[type]);
    });
  document
    .getElementById("toolbarCreateContact")
    .addEventListener("command", event => createContact());
  document
    .getElementById("toolbarCreateList")
    .addEventListener("command", event => createList());
  document
    .getElementById("toolbarImport")
    .addEventListener("command", event => importBook());

  document.getElementById("bookContext").addEventListener("command", event => {
    switch (event.target.id) {
      case "bookContextProperties":
        booksList.showPropertiesOfSelected();
        break;
      case "bookContextSynchronize":
        booksList.synchronizeSelected();
        break;
      case "bookContextPrint":
        booksList.printSelected();
        break;
      case "bookContextExport":
        booksList.exportSelected();
        break;
      case "bookContextDelete":
        booksList.deleteSelected();
        break;
      case "bookContextRemove":
        booksList.deleteSelected();
        break;
      case "bookContextStartupDefault":
        if (event.target.hasAttribute("checked")) {
          booksList.setSelectedAsStartupDefault();
        } else {
          booksList.clearStartupDefault();
        }
        break;
    }
  });

  booksList = document.getElementById("books");
  cardsPane.init();
  detailsPane.init();
  photoDialog.init();

  // Once the old Address Book has gone away, this should be changed to use
  // UIDs instead of URIs. It's just easier to keep as-is for now.
  let startupURI = Services.prefs.getStringPref(
    "mail.addr_book.view.startupURI",
    ""
  );
  if (startupURI) {
    for (let index = 0; index < booksList.rows.length; index++) {
      let row = booksList.rows[index];
      if (row._book?.URI == startupURI || row._list?.URI == startupURI) {
        booksList.selectedIndex = index;
        break;
      }
    }
  }

  if (booksList.selectedIndex == 0) {
    // Index 0 was selected before we started listening.
    booksList.dispatchEvent(new CustomEvent("select"));
  }

  cardsPane.searchInput.focus();

  window.dispatchEvent(new CustomEvent("about-addressbook-ready"));
});

window.addEventListener("unload", () => {
  // Once the old Address Book has gone away, this should be changed to use
  // UIDs instead of URIs. It's just easier to keep as-is for now.
  if (!Services.prefs.getBoolPref("mail.addr_book.view.startupURIisDefault")) {
    let pref = "mail.addr_book.view.startupURI";
    if (booksList.selectedIndex === 0) {
      Services.prefs.clearUserPref(pref);
    } else {
      let row = booksList.getRowAtIndex(booksList.selectedIndex);
      let directory = row._book || row._list;
      Services.prefs.setCharPref(pref, directory.URI);
    }
  }

  // Disconnect the view (if there is one) and tree, so that the view cleans
  // itself up and stops listening for observer service notifications.
  cardsPane.cardsList.view = null;
  detailsPane.uninit();
});

window.addEventListener("keypress", event => {
  // Prevent scrolling of the html tag when space is used.
  if (
    event.key == " " &&
    detailsPane.isEditing &&
    document.activeElement.tagName == "body"
  ) {
    event.preventDefault();
  }
  if (event.key != "F6" || event.altKey || event.ctrlKey || event.metaKey) {
    return;
  }
  if (detailsPane.isEditing) {
    return;
  }

  let targets = [booksList, cardsPane.searchInput, cardsPane.cardsList];
  if (!detailsPane.node.hidden && !detailsPane.editButton.hidden) {
    targets.push(detailsPane.editButton);
  }

  let focusedElementIndex = targets.findIndex(t => t.matches(":focus-within"));
  if (focusedElementIndex == -1) {
    focusedElementIndex = 0;
  }

  if (event.shiftKey) {
    focusedElementIndex--;
    if (focusedElementIndex == -1) {
      focusedElementIndex = targets.length - 1;
    }
  } else {
    focusedElementIndex++;
    if (focusedElementIndex == targets.length) {
      focusedElementIndex = 0;
    }
  }

  targets[focusedElementIndex].focus();
});

/**
 * Called on load from `toAddressBook` to create, display or edit a card.
 *
 * @param {"create"|"display"|"edit"} action - What to do with the args given.
 * @param {?string} address - Create a new card with this email address.
 * @param {?string} vCard - Create a new card from this vCard.
 * @param {?nsIAbCard} card - Display or edit this card.
 */
function externalAction({ action, address, card, vCard } = {}) {
  if (action == "create") {
    if (address) {
      detailsPane.editNewContact(
        `BEGIN:VCARD\r\nEMAIL:${address}\r\nEND:VCARD\r\n`
      );
    } else {
      detailsPane.editNewContact(vCard);
    }
  } else if (action == "display" || action == "edit") {
    if (!card || !card.directoryUID) {
      return;
    }

    let book = MailServices.ab.getDirectoryFromUID(card.directoryUID);
    if (!book) {
      return;
    }

    booksList.selectedIndex = booksList.getIndexForUID(card.directoryUID);
    cardsPane.cardsList.selectedIndex = cardsPane.cardsList.view.getIndexForUID(
      card.UID
    );

    if (action == "edit" && book && !book.readOnly) {
      detailsPane.editCurrentContact();
    }
  } else if (action == "print") {
    if (document.activeElement == booksList) {
      booksList.printSelected();
    } else {
      cardsPane.printSelected();
    }
  }
}

/**
 * Show UI to create a new address book of the type specified.
 *
 * @param {integer} [type=Ci.nsIAbManager.JS_DIRECTORY_TYPE] - One of the
 *     nsIAbManager directory type constants.
 */
function createBook(type = Ci.nsIAbManager.JS_DIRECTORY_TYPE) {
  const typeURLs = {
    [Ci.nsIAbManager.LDAP_DIRECTORY_TYPE]:
      "chrome://messenger/content/addressbook/pref-directory-add.xhtml",
    [Ci.nsIAbManager.JS_DIRECTORY_TYPE]:
      "chrome://messenger/content/addressbook/abAddressBookNameDialog.xhtml",
    [Ci.nsIAbManager.CARDDAV_DIRECTORY_TYPE]:
      "chrome://messenger/content/addressbook/abCardDAVDialog.xhtml",
  };

  let url = typeURLs[type];
  if (!url) {
    throw new Components.Exception(
      `Unexpected type: ${type}`,
      Cr.NS_ERROR_UNEXPECTED
    );
  }

  let params = {};
  SubDialog.open(
    url,
    {
      features: "resizable=no",
      closedCallback: () => {
        if (params.newDirectoryUID) {
          booksList.selectedIndex = booksList.getIndexForUID(
            params.newDirectoryUID
          );
          booksList.focus();
        }
      },
    },
    params
  );
}

/**
 * Show UI to create a new contact in the current address book.
 */
function createContact() {
  let row = booksList.getRowAtIndex(booksList.selectedIndex);
  let bookUID = row.dataset.book ?? row.dataset.uid;

  if (bookUID) {
    let book = MailServices.ab.getDirectoryFromUID(bookUID);
    if (book.readOnly) {
      throw new Components.Exception(
        "Address book is read-only",
        Cr.NS_ERROR_FAILURE
      );
    }
  }

  detailsPane.editNewContact();
}

/**
 * Show UI to create a new list in the current address book.
 * For now this loads the old list UI, the intention is to replace it.
 *
 * @param {nsIAbCard[]} cards - The contacts, if any, to add to the list.
 */
function createList(cards) {
  let row = booksList.getRowAtIndex(booksList.selectedIndex);
  let bookUID = row.dataset.book ?? row.dataset.uid;

  let params = { cards };
  if (bookUID) {
    let book = MailServices.ab.getDirectoryFromUID(bookUID);
    if (book.readOnly) {
      throw new Components.Exception(
        "Address book is read-only",
        Cr.NS_ERROR_FAILURE
      );
    }
    if (!book.supportsMailingLists) {
      throw new Components.Exception(
        "Address book does not support lists",
        Cr.NS_ERROR_FAILURE
      );
    }
    params.selectedAB = book.URI;
  }
  SubDialog.open(
    "chrome://messenger/content/addressbook/abMailListDialog.xhtml",
    {
      features: "resizable=no",
      closedCallback: () => {
        if (params.newListUID) {
          booksList.selectedIndex = booksList.getIndexForUID(params.newListUID);
          booksList.focus();
        }
      },
    },
    params
  );
}

/**
 * Import an address book from a file. This shows the generic Thunderbird
 * import wizard, which isn't ideal but better than nothing.
 */
function importBook() {
  let createdDirectory;
  let observer = function(subject) {
    // It might be possible for more than one directory to be imported, select
    // the first one.
    if (!createdDirectory) {
      createdDirectory = subject.QueryInterface(Ci.nsIAbDirectory);
    }
  };

  Services.obs.addObserver(observer, "addrbook-directory-created");
  window.browsingContext.topChromeWindow.toImport("addressBook");
  Services.obs.removeObserver(observer, "addrbook-directory-created");

  // Select the directory after the import UI closes, so the user sees the change.
  if (createdDirectory) {
    booksList.selectedIndex = booksList.getIndexForUID(createdDirectory.UID);
  }
}

// Books

/**
 * The list of address books.
 *
 * @extends {TreeListbox}
 */
class AbTreeListbox extends customElements.get("tree-listbox") {
  connectedCallback() {
    if (this.hasConnected) {
      return;
    }

    super.connectedCallback();
    this.setAttribute("is", "ab-tree-listbox");

    this.addEventListener("select", this);
    this.addEventListener("collapsed", this);
    this.addEventListener("expanded", this);
    this.addEventListener("keypress", this);
    this.addEventListener("contextmenu", this);
    this.addEventListener("dragover", this);
    this.addEventListener("drop", this);

    // FIXME: Do this with HTML when we get new strings.
    document.l10n.ready.then(() => {
      this.firstElementChild.title = this.firstElementChild.querySelector(
        ".bookRow-name"
      ).textContent;
    });
    for (let book of MailServices.ab.directories) {
      this.appendChild(this._createBookRow(book));
    }

    this._abObserver.observe = this._abObserver.observe.bind(this);
    for (let topic of this._abObserver._notifications) {
      Services.obs.addObserver(this._abObserver, topic, true);
    }

    window.addEventListener("unload", this);
  }

  destroy() {
    this.removeEventListener("select", this);
    this.removeEventListener("collapsed", this);
    this.removeEventListener("expanded", this);
    this.removeEventListener("keypress", this);
    this.removeEventListener("contextmenu", this);
    this.removeEventListener("dragover", this);
    this.removeEventListener("drop", this);

    for (let topic of this._abObserver._notifications) {
      Services.obs.removeObserver(this._abObserver, topic);
    }
  }

  handleEvent(event) {
    super.handleEvent(event);

    switch (event.type) {
      case "select":
        this._onSelect(event);
        break;
      case "collapsed":
        this._onCollapsed(event);
        break;
      case "expanded":
        this._onExpanded(event);
        break;
      case "keypress":
        this._onKeyPress(event);
        break;
      case "contextmenu":
        this._onContextMenu(event);
        break;
      case "dragover":
        this._onDragOver(event);
        break;
      case "drop":
        this._onDrop(event);
        break;
      case "unload":
        this.destroy();
        break;
    }
  }

  _createBookRow(book) {
    let row = document
      .getElementById("bookRow")
      .content.firstElementChild.cloneNode(true);
    row.id = `book-${book.UID}`;
    row.setAttribute("aria-label", book.dirName);
    row.title = book.dirName;
    if (
      Services.xulStore.getValue("about:addressbook", row.id, "collapsed") ==
      "true"
    ) {
      row.classList.add("collapsed");
    }
    if (book.isRemote) {
      row.classList.add("remote");
    }
    if (book.readOnly) {
      row.classList.add("readOnly");
    }
    if (
      ["ldap_2.servers.history", "ldap_2.servers.pab"].includes(book.dirPrefId)
    ) {
      row.classList.add("noDelete");
    }
    if (book.dirType == Ci.nsIAbManager.CARDDAV_DIRECTORY_TYPE) {
      row.classList.add("carddav");
    }
    row.dataset.uid = book.UID;
    row._book = book;
    row.querySelector("span").textContent = book.dirName;

    for (let list of book.childNodes) {
      row.querySelector("ul").appendChild(this._createListRow(book.UID, list));
    }
    return row;
  }

  _createListRow(bookUID, list) {
    let row = document
      .getElementById("listRow")
      .content.firstElementChild.cloneNode(true);
    row.id = `list-${list.UID}`;
    row.setAttribute("aria-label", list.dirName);
    row.title = list.dirName;
    row.dataset.uid = list.UID;
    row.dataset.book = bookUID;
    row._list = list;
    row.querySelector("span").textContent = list.dirName;
    return row;
  }

  /**
   * Get the index of the row representing a book or list.
   *
   * @param {string|null} uid - The UID of the book or list to find, or null
   *     for All Address Books.
   * @returns {integer} - Index of the book or list.
   */
  getIndexForUID(uid) {
    if (!uid) {
      return 0;
    }
    return this.rows.findIndex(r => r.dataset.uid == uid);
  }

  /**
   * Get the row representing a book or list.
   *
   * @param {string|null} uid - The UID of the book or list to find, or null
   *     for All Address Books.
   * @returns {HTMLLIElement} - Row of the book or list.
   */
  getRowForUID(uid) {
    if (!uid) {
      return this.firstElementChild;
    }
    return this.querySelector(`li[data-uid="${uid}"]`);
  }

  /**
   * Show UI to modify the selected address book or list.
   */
  showPropertiesOfSelected() {
    if (this.selectedIndex === 0) {
      throw new Components.Exception(
        "Cannot modify the All Address Books item",
        Cr.NS_ERROR_UNEXPECTED
      );
    }

    let row = this.rows[this.selectedIndex];

    if (row.classList.contains("listRow")) {
      let book = MailServices.ab.getDirectoryFromUID(row.dataset.book);
      let list = book.childNodes.find(l => l.UID == row.dataset.uid);

      SubDialog.open(
        "chrome://messenger/content/addressbook/abEditListDialog.xhtml",
        { features: "resizable=no" },
        { listURI: list.URI }
      );
      return;
    }

    let book = MailServices.ab.getDirectoryFromUID(row.dataset.uid);

    SubDialog.open(
      book.propertiesChromeURI,
      { features: "resizable=no" },
      { selectedDirectory: book }
    );
  }

  /**
   * Synchronize the selected address book. (CardDAV only.)
   */
  synchronizeSelected() {
    let row = this.rows[this.selectedIndex];
    if (!row.classList.contains("carddav")) {
      throw new Components.Exception(
        "Attempting to synchronize a non-CardDAV book.",
        Cr.NS_ERROR_UNEXPECTED
      );
    }

    let directory = MailServices.ab.getDirectoryFromUID(row.dataset.uid);
    directory = CardDAVDirectory.forFile(directory.fileName);
    directory.syncWithServer();
  }

  /**
   * Print the selected address book.
   */
  printSelected() {
    if (this.selectedIndex === 0) {
      printHandler.printDirectory();
      return;
    }

    let row = this.rows[this.selectedIndex];
    if (row.classList.contains("listRow")) {
      let book = MailServices.ab.getDirectoryFromUID(row.dataset.book);
      let list = book.childNodes.find(l => l.UID == row.dataset.uid);
      printHandler.printDirectory(list);
    } else {
      let book = MailServices.ab.getDirectoryFromUID(row.dataset.uid);
      printHandler.printDirectory(book);
    }
  }

  /**
   * Export the selected address book to a file.
   */
  exportSelected() {
    if (this.selectedIndex == 0) {
      return;
    }

    let row = this.getRowAtIndex(this.selectedIndex);
    let directory = row._book || row._list;
    AddrBookUtils.exportDirectory(directory);
  }

  /**
   * Prompt the user and delete the selected address book.
   */
  async deleteSelected() {
    if (this.selectedIndex === 0) {
      throw new Components.Exception(
        "Cannot delete the All Address Books item",
        Cr.NS_ERROR_UNEXPECTED
      );
    }

    let row = this.rows[this.selectedIndex];
    if (row.classList.contains("noDelete")) {
      throw new Components.Exception(
        "Refusing to delete a built-in address book",
        Cr.NS_ERROR_UNEXPECTED
      );
    }

    let action, name, uri;
    if (row.classList.contains("listRow")) {
      action = "delete-lists";
      name = row._list.dirName;
      uri = row._list.URI;
    } else {
      if (
        [
          Ci.nsIAbManager.CARDDAV_DIRECTORY_TYPE,
          Ci.nsIAbManager.LDAP_DIRECTORY_TYPE,
        ].includes(row._book.dirType)
      ) {
        action = "remove-remote-book";
      } else {
        action = "delete-book";
      }

      name = row._book.dirName;
      uri = row._book.URI;
    }

    let [title, message] = await document.l10n.formatValues([
      { id: `about-addressbook-confirm-${action}-title`, args: { count: 1 } },
      {
        id: `about-addressbook-confirm-${action}`,
        args: { name, count: 1 },
      },
    ]);

    if (
      Services.prompt.confirmEx(
        window,
        title,
        message,
        Ci.nsIPromptService.STD_YES_NO_BUTTONS,
        null,
        null,
        null,
        null,
        {}
      ) === 0
    ) {
      MailServices.ab.deleteAddressBook(uri);
    }
  }

  /**
   * Set the selected directory to be the one opened when the page opens.
   */
  setSelectedAsStartupDefault() {
    // Once the old Address Book has gone away, this should be changed to use
    // UIDs instead of URIs. It's just easier to keep as-is for now.
    Services.prefs.setBoolPref("mail.addr_book.view.startupURIisDefault", true);
    if (this.selectedIndex === 0) {
      Services.prefs.clearUserPref("mail.addr_book.view.startupURI");
      return;
    }

    let row = this.rows[this.selectedIndex];
    let directory = row._book || row._list;
    Services.prefs.setStringPref(
      "mail.addr_book.view.startupURI",
      directory.URI
    );
  }

  /**
   * Clear the directory to be opened when the page opens. Instead, the
   * last-selected directory will be opened.
   */
  clearStartupDefault() {
    Services.prefs.setBoolPref(
      "mail.addr_book.view.startupURIisDefault",
      false
    );
  }

  _onSelect() {
    let row = this.rows[this.selectedIndex];
    if (row.classList.contains("listRow")) {
      cardsPane.displayList(row.dataset.book, row.dataset.uid);
    } else {
      cardsPane.displayBook(row.dataset.uid);
    }

    // Row 0 is the "All Address Books" item.
    if (this.selectedIndex === 0) {
      document.getElementById("toolbarCreateContact").disabled = false;
      document.getElementById("toolbarCreateList").disabled = false;
    } else {
      let bookUID = row.dataset.book ?? row.dataset.uid;
      let book = MailServices.ab.getDirectoryFromUID(bookUID);

      document.getElementById("toolbarCreateContact").disabled = book.readOnly;
      document.getElementById("toolbarCreateList").disabled =
        book.readOnly || !book.supportsMailingLists;
    }
  }

  _onCollapsed(event) {
    Services.xulStore.setValue(
      "about:addressbook",
      event.target.id,
      "collapsed",
      "true"
    );
  }

  _onExpanded(event) {
    Services.xulStore.removeValue(
      "about:addressbook",
      event.target.id,
      "collapsed"
    );
  }

  _onKeyPress(event) {
    if (event.altKey || event.metaKey || event.shiftKey) {
      return;
    }

    switch (event.key) {
      case "Delete":
        this.deleteSelected();
        break;
    }
  }

  _onClick(event) {
    super._onClick(event);

    // Only handle left-clicks. Right-clicking on the menu button will cause
    // the menu to appear anyway, and other buttons can be ignored.
    if (
      event.button !== 0 ||
      !event.target.closest(".bookRow-menu, .listRow-menu")
    ) {
      return;
    }

    this._showContextMenu(event);
  }

  _onContextMenu(event) {
    this._showContextMenu(event);
  }

  _onDragOver(event) {
    let cards = event.dataTransfer.mozGetDataAt("moz/abcard-array", 0);
    if (!cards) {
      return;
    }
    if (cards.some(c => c.isMailList)) {
      return;
    }

    // TODO: Handle dropping a vCard here.

    let row = event.target.closest("li");
    if (!row || row.classList.contains("readOnly")) {
      return;
    }

    let rowIsList = row.classList.contains("listRow");
    event.dataTransfer.effectAllowed = rowIsList ? "link" : "copyMove";

    if (rowIsList) {
      let bookUID = row.dataset.book;
      for (let card of cards) {
        if (card.directoryUID != bookUID) {
          return;
        }
      }
      event.dataTransfer.dropEffect = "link";
    } else {
      let bookUID = row.dataset.uid;
      for (let card of cards) {
        // Prevent dropping a card where it already is.
        if (card.directoryUID == bookUID) {
          return;
        }
      }
      event.dataTransfer.dropEffect = event.ctrlKey ? "copy" : "move";
    }

    event.preventDefault();
  }

  _onDrop(event) {
    if (event.dataTransfer.dropEffect == "none") {
      // Somehow this is possible. It should not be possible.
      return;
    }

    let cards = event.dataTransfer.mozGetDataAt("moz/abcard-array", 0);
    let row = event.target.closest("li");

    if (row.classList.contains("listRow")) {
      for (let card of cards) {
        row._list.addCard(card);
      }
    } else if (event.dataTransfer.dropEffect == "copy") {
      for (let card of cards) {
        row._book.dropCard(card, true);
      }
    } else {
      let booksMap = new Map();
      let bookUID = row.dataset.uid;
      for (let card of cards) {
        if (bookUID == card.directoryUID) {
          continue;
        }
        row._book.dropCard(card, false);
        let bookSet = booksMap.get(card.directoryUID);
        if (!bookSet) {
          bookSet = new Set();
          booksMap.set(card.directoryUID, bookSet);
        }
        bookSet.add(card);
      }
      for (let [uid, bookSet] of booksMap) {
        MailServices.ab.getDirectoryFromUID(uid).deleteCards([...bookSet]);
      }
    }

    event.preventDefault();
  }

  _showContextMenu(event) {
    let row;
    if (event.target == this) {
      row = this.rows[this.selectedIndex];
    } else {
      row = event.target.closest("li");
    }
    if (!row) {
      return;
    }

    let popup = document.getElementById("bookContext");
    let synchronizeItem = document.getElementById("bookContextSynchronize");
    let exportItem = document.getElementById("bookContextExport");
    let deleteItem = document.getElementById("bookContextDelete");
    let removeItem = document.getElementById("bookContextRemove");
    let startupDefaultItem = document.getElementById(
      "bookContextStartupDefault"
    );

    let isDefault = Services.prefs.getBoolPref(
      "mail.addr_book.view.startupURIisDefault"
    );

    this.selectedIndex = this.rows.indexOf(row);
    this.focus();
    if (this.selectedIndex === 0) {
      // All Address Books - only the startup default item is relevant.
      for (let item of popup.children) {
        item.hidden = item != startupDefaultItem;
      }

      isDefault =
        isDefault &&
        !Services.prefs.prefHasUserValue("mail.addr_book.view.startupURI");
    } else {
      for (let item of popup.children) {
        item.hidden = false;
      }

      synchronizeItem.hidden = !row.classList.contains("carddav");
      exportItem.hidden = row.classList.contains("remote");

      deleteItem.disabled = row.classList.contains("noDelete");
      deleteItem.hidden = row.classList.contains("carddav");

      removeItem.disabled = row.classList.contains("noDelete");
      removeItem.hidden = !row.classList.contains("carddav");

      let directory = row._book || row._list;
      isDefault =
        isDefault &&
        Services.prefs.getStringPref("mail.addr_book.view.startupURI") ==
          directory.URI;
    }

    if (isDefault) {
      startupDefaultItem.setAttribute("checked", "true");
    } else {
      startupDefaultItem.removeAttribute("checked");
    }

    if (event.type == "contextmenu" && event.button == 2) {
      // This is a right-click. Open where it happened.
      popup.openPopupAtScreen(event.screenX, event.screenY, true);
    } else {
      // This is a click on the menu button, or the context menu key was
      // pressed. Open near the menu button.
      popup.openPopup(
        row.querySelector(".bookRow-container, .listRow-container"),
        { triggerEvent: event, position: "end_before", x: -26, y: 30 }
      );
    }
    event.preventDefault();
  }

  _abObserver = {
    QueryInterface: ChromeUtils.generateQI([
      "nsIObserver",
      "nsISupportsWeakReference",
    ]),

    _notifications: [
      "addrbook-directory-created",
      "addrbook-directory-updated",
      "addrbook-directory-deleted",
      "addrbook-directory-request-start",
      "addrbook-directory-request-end",
      "addrbook-list-created",
      "addrbook-list-updated",
      "addrbook-list-deleted",
    ],

    // Bound to `booksList`.
    observe(subject, topic, data) {
      subject.QueryInterface(Ci.nsIAbDirectory);

      switch (topic) {
        case "addrbook-directory-created": {
          let row = this._createBookRow(subject);
          let next = this.children[1];
          while (next) {
            if (
              AddrBookUtils.compareAddressBooks(
                subject,
                MailServices.ab.getDirectoryFromUID(next.dataset.uid)
              ) < 0
            ) {
              break;
            }
            next = next.nextElementSibling;
          }
          this.insertBefore(row, next);
          break;
        }
        case "addrbook-directory-updated":
        case "addrbook-list-updated": {
          let row = this.getRowForUID(subject.UID);
          row.querySelector(".bookRow-name, .listRow-name").textContent =
            subject.dirName;
          row.setAttribute("aria-label", subject.dirName);
          if (cardsPane.cardsList.view.directory?.UID == subject.UID) {
            document.l10n.setAttributes(
              cardsPane.searchInput,
              "about-addressbook-search",
              { name: subject.dirName }
            );
          }
          break;
        }
        case "addrbook-directory-deleted": {
          let row = this.getRowForUID(subject.UID);
          row.remove();
          if (
            row.classList.contains("selected") ||
            row.querySelector("li.selected")
          ) {
            // Select "All Address Books".
            setTimeout(() => {
              this.selectedIndex = 0;
            });
          }
          break;
        }
        case "addrbook-directory-request-start":
          this.getRowForUID(data).classList.add("requesting");
          break;
        case "addrbook-directory-request-end":
          this.getRowForUID(data).classList.remove("requesting");
          break;
        case "addrbook-list-created": {
          let row = this.getRowForUID(data);
          let childList = row.querySelector("ul");
          if (!childList) {
            childList = row.appendChild(document.createElement("ul"));
          }

          let listRow = this._createListRow(data, subject);
          let next = childList.firstElementChild;
          while (next) {
            if (AddrBookUtils.compareAddressBooks(subject, next._list) < 0) {
              break;
            }
            next = next.nextElementSibling;
          }
          childList.insertBefore(listRow, next);
          break;
        }
        case "addrbook-list-deleted": {
          let row = this.getRowForUID(data);
          let childList = row.querySelector("ul");
          let listRow = childList.querySelector(`[data-uid="${subject.UID}"]`);
          listRow.remove();
          if (childList.childElementCount == 0) {
            setTimeout(() => childList.remove());
          }
          break;
        }
      }
    },
  };
}
customElements.define("ab-tree-listbox", AbTreeListbox, { extends: "ul" });

// Cards

/**
 * Search field for card list. An HTML port of MozSearchTextbox.
 */
class AbCardSearchInput extends HTMLInputElement {
  connectedCallback() {
    if (this.hasConnected) {
      return;
    }
    this.hasConnected = true;

    this._fireCommand = this._fireCommand.bind(this);

    this.addEventListener("input", this);
    this.addEventListener("keypress", this);
  }

  handleEvent(event) {
    switch (event.type) {
      case "input":
        this._onInput(event);
        break;
      case "keypress":
        this._onKeyPress(event);
        break;
    }
  }

  _onInput() {
    if (this._timer) {
      clearTimeout(this._timer);
    }
    this._timer = setTimeout(this._fireCommand, 500, this);
  }

  _onKeyPress(event) {
    switch (event.key) {
      case "Escape":
        if (this._clearSearch()) {
          event.preventDefault();
          event.stopPropagation();
        }
        break;
      case "Return":
        this._enterSearch();
        event.preventDefault();
        event.stopPropagation();
        break;
    }
  }

  _fireCommand() {
    if (this._timer) {
      clearTimeout(this._timer);
    }
    this._timer = null;
    this.dispatchEvent(new CustomEvent("command"));
  }

  _enterSearch() {
    this._fireCommand();
  }

  _clearSearch() {
    if (this.value) {
      this.value = "";
      this._fireCommand();
      return true;
    }
    return false;
  }
}
customElements.define("ab-card-search-input", AbCardSearchInput, {
  extends: "input",
});

/**
 * A row in the list of cards.
 *
 * @extends {TreeViewListrow}
 */
class AbCardListrow extends customElements.get("tree-view-listrow") {
  static ROW_HEIGHT = 46;

  connectedCallback() {
    if (this.hasConnected) {
      return;
    }

    super.connectedCallback();

    this.setAttribute("draggable", "true");

    this.avatar = this.appendChild(document.createElement("div"));
    this.avatar.classList.add("recipient-avatar");
    let dataContainer = this.appendChild(document.createElement("div"));
    dataContainer.classList.add("ab-card-listrow-data");

    let firstLine = dataContainer.appendChild(document.createElement("p"));
    firstLine.classList.add("ab-card-first-line");
    this.name = firstLine.appendChild(document.createElement("span"));
    this.name.classList.add("name");

    let secondLine = dataContainer.appendChild(document.createElement("p"));
    secondLine.classList.add("ab-card-second-line");
    this.address = secondLine.appendChild(document.createElement("span"));
    this.address.classList.add("address");
  }

  get index() {
    return super.index;
  }

  set index(index) {
    if (this._index == index) {
      return;
    }
    super.index = index;

    let props = this.view.getRowProperties(index);
    if (props) {
      this.classList.add(props);
    }

    let card = this.view.getCardFromRow(index);
    this.name.textContent = this.view.getCellText(index, {
      id: "GeneratedName",
    });

    // Don't try to fetch the avatar or show the parent AB if this is a list.
    if (!card.isMailList) {
      let photoURL = card.photoURL;
      if (photoURL) {
        let img = document.createElement("img");
        img.alt = this.name.textContent;
        img.src = photoURL;
        this.avatar.appendChild(img);
      } else {
        let letter = document.createElement("span");
        letter.textContent = Array.from(
          this.name.textContent
        )[0]?.toUpperCase();
        letter.setAttribute("aria-hidden", "true");
        this.avatar.appendChild(letter);
      }
      this.address.textContent = card.primaryEmail;
    } else {
      let img = this.avatar.appendChild(document.createElement("img"));
      img.alt = "";
      img.src = "chrome://messenger/skin/icons/new/compact/user-list.svg";
      this.avatar.classList.add("is-mail-list");
    }

    this.setAttribute("aria-label", this.name.textContent);
  }
}
customElements.define("ab-card-listrow", AbCardListrow);

class AbTableCardListrow extends customElements.get("tree-view-listrow") {
  static ROW_HEIGHT = 22;

  static COLUMNS = [
    ["GeneratedName", true],
    ["EmailAddresses", true],
    ["PhoneNumbers", true],
    ["Addresses", true],
    ["Title", false],
    ["Department", false],
    ["Organization", false],
    ["addrbook", false],
  ];

  static densityChange() {
    switch (UIDensity.prefValue) {
      case UIDensity.MODE_COMPACT:
        AbTableCardListrow.ROW_HEIGHT = 18;
        break;
      case UIDensity.MODE_TOUCH:
        AbTableCardListrow.ROW_HEIGHT = 32;
        break;
      default:
        AbTableCardListrow.ROW_HEIGHT = 22;
        break;
    }
  }

  connectedCallback() {
    if (this.hasConnected) {
      return;
    }

    super.connectedCallback();

    for (let [column] of AbTableCardListrow.COLUMNS) {
      this.appendChild(document.createElement("div")).classList.add(
        `${column.toLowerCase()}-column`
      );
    }
  }

  get index() {
    return super.index;
  }

  set index(index) {
    if (this._index == index) {
      return;
    }
    super.index = index;
    let props = this.view.getRowProperties(index);
    if (props) {
      this.classList.add(props);
    }

    for (let [column, shown] of AbTableCardListrow.COLUMNS) {
      let cell = this.querySelector(`.${column.toLowerCase()}-column`);
      if (shown) {
        cell.textContent = this.view.getCellText(index, { id: column });
      } else {
        cell.hidden = true;
      }
    }
    this.setAttribute("aria-label", this.firstElementChild.textContent);
  }
}
customElements.define("ab-table-card-listrow", AbTableCardListrow);

var cardsPane = {
  searchInput: null,

  cardsList: null,

  init() {
    this.searchInput = document.getElementById("searchInput");
    this.sortButton = document.getElementById("sortButton");
    this.sortContext = document.getElementById("sortContext");
    this.cardsHeader = document.getElementById("cardsHeader");
    this.cardsList = document.getElementById("cards");
    this.cardContext = document.getElementById("cardContext");

    if (
      Services.xulStore.getValue("about:addressbook", "cardsPane", "layout") ==
      "table"
    ) {
      this.toggleLayout(true);
    }

    let nameFormat = Services.prefs.getIntPref(
      "mail.addr_book.lastnamefirst",
      0
    );
    this.sortContext
      .querySelector(`[name="format"][value="${nameFormat}"]`)
      ?.setAttribute("checked", "true");

    let columns = Services.xulStore.getValue(
      "about:addressbook",
      "cards",
      "columns"
    );
    if (columns) {
      columns = columns.split(",");
      for (let columnDef of AbTableCardListrow.COLUMNS) {
        columnDef[1] = columns.includes(columnDef[0]);
      }
    }

    let separator = this.sortContext.querySelector(
      "menuseparator:last-of-type"
    );
    for (let [column, shown] of AbTableCardListrow.COLUMNS) {
      let header = this.cardsHeader.appendChild(
        document.createElement("button")
      );
      header.classList.add("table-header");
      header.classList.add(`${column.toLowerCase()}-column`);
      header.value = column;
      header.hidden = !shown;
      document.l10n.setAttributes(
        header,
        `about-addressbook-column-header-${column.toLowerCase()}`
      );
      // about-addressbook-column-header-generatedname
      // about-addressbook-column-header-emailaddresses
      // about-addressbook-column-header-phonenumbers
      // about-addressbook-column-header-addresses
      // about-addressbook-column-header-title
      // about-addressbook-column-header-department
      // about-addressbook-column-header-organization
      // about-addressbook-column-header-addrbook

      if (column == "GeneratedName") {
        continue;
      }

      let menuitem = this.sortContext.insertBefore(
        document.createXULElement("menuitem"),
        separator
      );
      menuitem.setAttribute("type", "checkbox");
      menuitem.setAttribute("name", "toggle");
      menuitem.setAttribute("value", column);
      menuitem.setAttribute("closemenu", "none");
      document.l10n.setAttributes(
        menuitem,
        `about-addressbook-column-label-${column.toLowerCase()}`
      );
      // about-addressbook-column-label-generatedname
      // about-addressbook-column-label-emailaddresses
      // about-addressbook-column-label-phonenumbers
      // about-addressbook-column-label-addresses
      // about-addressbook-column-label-title
      // about-addressbook-column-label-department
      // about-addressbook-column-label-organization
      // about-addressbook-column-label-addrbook

      if (shown) {
        menuitem.setAttribute("checked", "true");
      }
    }

    this.searchInput.addEventListener("command", this);
    this.sortButton.addEventListener("click", this);
    this.sortContext.addEventListener("command", this);
    this.cardsHeader.addEventListener("click", this);
    this.cardsList.addEventListener("select", this);
    this.cardsList.addEventListener("keydown", this);
    this.cardsList.addEventListener("dblclick", this);
    this.cardsList.addEventListener("dragstart", this);
    this.cardsList.addEventListener("contextmenu", this);
    this.cardsList.addEventListener("searchstatechange", () =>
      this._updatePlaceholder()
    );
    this.cardContext.addEventListener("command", this);

    this.cardsList.addEventListener("overflow", event => {
      if (event.target == this.cardsList) {
        this.cardsHeader.style.overflowY = "scroll";
      }
    });
    this.cardsList.addEventListener("underflow", event => {
      if (event.target == this.cardsList) {
        this.cardsHeader.style.overflowY = null;
      }
    });
    window.addEventListener("uidensitychange", () => {
      AbTableCardListrow.densityChange();
      if (cardsPane.cardsList.getAttribute("rows") == "ab-table-card-listrow") {
        cardsPane.cardsList.invalidate();
      }
    });
    AbTableCardListrow.densityChange();

    document
      .getElementById("placeholderCreateContact")
      .addEventListener("click", () => createContact());
  },

  handleEvent(event) {
    switch (event.type) {
      case "command":
        this._onCommand(event);
        break;
      case "click":
        this._onClick(event);
        break;
      case "select":
        this._onSelect(event);
        break;
      case "keydown":
        this._onKeyDown(event);
        break;
      case "dblclick":
        this._onDoubleClick(event);
        break;
      case "dragstart":
        this._onDragStart(event);
        break;
      case "contextmenu":
        this._onContextMenu(event);
        break;
    }
  },

  /**
   * Switch between list and table layouts.
   *
   * @param {?boolean} isTableLayout - Use table layout if `true` or list
   *   layout if `false`. If unspecified, switch layouts.
   */
  toggleLayout(isTableLayout) {
    isTableLayout = document.body.classList.toggle(
      "layout-table",
      isTableLayout
    );
    document.body.classList.toggle("layout-list", !isTableLayout);

    this.cardsList.setAttribute(
      "rows",
      isTableLayout ? "ab-table-card-listrow" : "ab-card-listrow"
    );
    this.cardsList.scrollToIndex(this.cardsList.selectedIndex);
    Services.xulStore.setValue(
      "about:addressbook",
      "cardsPane",
      "layout",
      isTableLayout ? "table" : "list"
    );
  },

  /**
   * Gets an address book query string based on the value of the search input.
   *
   * @returns {string}
   */
  getQuery() {
    if (!this.searchInput.value) {
      return null;
    }

    let searchWords = ABQueryUtils.getSearchTokens(this.searchInput.value);
    let queryURIFormat = ABQueryUtils.getModelQuery(
      "mail.addr_book.quicksearchquery.format"
    );
    return ABQueryUtils.generateQueryURI(queryURIFormat, searchWords);
  },

  /**
   * Display an address book, or all address books.
   *
   * @param {string|null} uid - The UID of the book or list to display, or null
   *     for All Address Books.
   */
  displayBook(uid) {
    let book = uid ? MailServices.ab.getDirectoryFromUID(uid) : null;
    if (book) {
      document.l10n.setAttributes(
        this.searchInput,
        "about-addressbook-search",
        { name: book.dirName }
      );
    } else {
      document.l10n.setAttributes(
        this.searchInput,
        "about-addressbook-search-all"
      );
    }
    let sortColumn =
      Services.xulStore.getValue("about:addressbook", "cards", "sortColumn") ||
      "GeneratedName";
    let sortDirection =
      Services.xulStore.getValue(
        "about:addressbook",
        "cards",
        "sortDirection"
      ) || "ascending";
    this.cardsList.view = new ABView(
      book,
      this.getQuery(),
      this.searchInput.value,
      sortColumn,
      sortDirection
    );
    this.sortCards(sortColumn, sortDirection);
    this._updatePlaceholder();

    detailsPane.displayCards();
  },

  /**
   * Display a list.
   *
   * @param {bookUID} uid - The UID of the address book containing the list.
   * @param {string} uid - The UID of the list to display.
   */
  displayList(bookUID, uid) {
    let book = MailServices.ab.getDirectoryFromUID(bookUID);
    let list = book.childNodes.find(l => l.UID == uid);
    document.l10n.setAttributes(this.searchInput, "about-addressbook-search", {
      name: list.dirName,
    });
    let sortColumn =
      Services.xulStore.getValue("about:addressbook", "cards", "sortColumn") ||
      "GeneratedName";
    let sortDirection =
      Services.xulStore.getValue(
        "about:addressbook",
        "cards",
        "sortDirection"
      ) || "ascending";
    this.cardsList.view = new ABView(
      list,
      this.getQuery(),
      this.searchInput.value,
      sortColumn,
      sortDirection
    );
    this.sortCards(sortColumn, sortDirection);
    this._updatePlaceholder();

    detailsPane.displayCards();
  },

  get selectedCards() {
    return this.cardsList.selectedIndices.map(i =>
      this.cardsList.view.getCardFromRow(i)
    );
  },

  /**
   * Display the right message in the cards list placeholder. The placeholder
   * is only visible if there are no cards in the list, but it's kept
   * up-to-date at all times, so we don't have to keep track of the size of
   * the list.
   */
  _updatePlaceholder() {
    let { directory, searchState } = this.cardsList.view;

    let idsToShow;
    switch (searchState) {
      case ABView.NOT_SEARCHING:
        if (directory?.isRemote && !Services.io.offline) {
          idsToShow = ["placeholderSearchOnly"];
        } else {
          idsToShow = ["placeholderEmptyBook"];
          if (!directory?.readOnly && !directory?.isMailList) {
            idsToShow.push("placeholderCreateContact");
          }
        }
        break;
      case ABView.SEARCHING:
        idsToShow = ["placeholderSearching"];
        break;
      case ABView.SEARCH_COMPLETE:
        idsToShow = ["placeholderNoSearchResults"];
        break;
    }

    for (let element of document.getElementById("cardsPlaceholder").children) {
      element.hidden = !idsToShow.includes(element.id);
    }
  },

  /**
   * Set the name format to be displayed.
   *
   * @param {integer} format - One of the nsIAbCard.GENERATE_* constants.
   */
  setNameFormat(event) {
    // ABView will detect this change and update automatically.
    Services.prefs.setIntPref(
      "mail.addr_book.lastnamefirst",
      event.target.value
    );
  },

  /**
   * Change the sort order of the cards being displayed. If `column` and
   * `direction` match the existing values no sorting occurs but the UI items
   * are always updated.
   *
   * @param {string} column
   * @param {"ascending"|"descending"} direction
   */
  sortCards(column, direction) {
    // Uncheck the sort button menu item for the previously sorted column, if
    // there is one, then check the sort button menu item for the column to be
    // sorted.
    this.sortContext
      .querySelector(`[name="sort"][checked]`)
      ?.removeAttribute("checked");
    this.sortContext
      .querySelector(`[name="sort"][value="${column} ${direction}"]`)
      ?.setAttribute("checked", "true");

    // Unmark the header of previously sorted column, then mark the header of
    // the column to be sorted.
    this.cardsHeader
      .querySelector(".ascending, .descending")
      ?.classList.remove("ascending", "descending");
    this.cardsHeader
      .querySelector(`[value="${column}"]`)
      ?.classList.add(direction);

    if (
      this.cardsList.view.sortColumn == column &&
      this.cardsList.view.sortDirection == direction
    ) {
      return;
    }

    this.cardsList.view.sortBy(column, direction);

    Services.xulStore.setValue(
      "about:addressbook",
      "cards",
      "sortColumn",
      column
    );
    Services.xulStore.setValue(
      "about:addressbook",
      "cards",
      "sortDirection",
      direction
    );
  },

  /**
   * Start a new message to the given addresses.
   *
   * @param {string[]} addresses
   */
  writeTo(addresses) {
    let params = Cc[
      "@mozilla.org/messengercompose/composeparams;1"
    ].createInstance(Ci.nsIMsgComposeParams);
    params.type = Ci.nsIMsgCompType.New;
    params.format = Ci.nsIMsgCompFormat.Default;
    params.composeFields = Cc[
      "@mozilla.org/messengercompose/composefields;1"
    ].createInstance(Ci.nsIMsgCompFields);

    params.composeFields.to = addresses.join(",");
    MailServices.compose.OpenComposeWindowWithParams(null, params);
  },

  /**
   * Start a new message to the selected contact(s) and/or mailing list(s).
   */
  writeToSelected() {
    let selectedAddresses = [];

    for (let card of this.selectedCards) {
      let email;
      if (card.isMailList) {
        email = card.getProperty("Notes", "") || card.displayName;
      } else {
        email = card.emailAddresses[0];
      }

      if (email) {
        selectedAddresses.push(
          MailServices.headerParser.makeMimeAddress(card.displayName, email)
        );
      }
    }

    this.writeTo(selectedAddresses);
  },

  /**
   * Print delete the selected card(s).
   */
  printSelected() {
    let selectedCards = this.selectedCards;
    if (selectedCards.length) {
      // Some cards are selected. Print them.
      printHandler.printCards(selectedCards);
    } else if (this.cardsList.view.searchString) {
      // Nothing's selected, so print everything. But this is a search, so we
      // can't just print the selected book/list.
      let allCards = [];
      for (let i = 0; i < this.cardsList.view.rowCount; i++) {
        allCards.push(this.cardsList.view.getCardFromRow(i));
      }
      printHandler.printCards(allCards);
    } else {
      // Nothing's selected, so print the selected book/list.
      booksList.printSelected();
    }
  },

  _canModifySelected() {
    if (this.cardsList.view.directory?.readOnly) {
      return false;
    }

    let seenDirectories = new Set();
    for (let index of this.cardsList.selectedIndices) {
      let { directoryUID } = this.cardsList.view.getCardFromRow(index);
      if (seenDirectories.has(directoryUID)) {
        continue;
      }
      if (MailServices.ab.getDirectoryFromUID(directoryUID).readOnly) {
        return false;
      }
      seenDirectories.add(directoryUID);
    }
    return true;
  },

  /**
   * Prompt the user and delete the selected card(s).
   */
  async deleteSelected() {
    if (!this._canModifySelected()) {
      return;
    }

    let selectedLists = [];
    let selectedContacts = [];

    for (let index of this.cardsList.selectedIndices) {
      let card = this.cardsList.view.getCardFromRow(index);
      if (card.isMailList) {
        selectedLists.push(card);
      } else {
        selectedContacts.push(card);
      }
    }

    if (selectedLists.length + selectedContacts.length == 0) {
      return;
    }

    // Determine strings for smart and context-sensitive user prompts
    // for confirming deletion.
    let action, name, list;
    let count = selectedLists.length + selectedContacts.length;
    let selectedDir = this.cardsList.view.directory;

    if (selectedLists.length && selectedContacts.length) {
      action = "delete-mixed";
    } else if (selectedLists.length) {
      action = "delete-lists";
      name = selectedLists[0].displayName;
    } else {
      let nameFormatFromPref = Services.prefs.getIntPref(
        "mail.addr_book.lastnamefirst"
      );
      name = selectedContacts[0].generateName(nameFormatFromPref);
      if (selectedDir && selectedDir.isMailList) {
        action = "remove-contacts";
        list = selectedDir.dirName;
      } else {
        action = "delete-contacts";
      }
    }

    let [title, message] = await document.l10n.formatValues([
      { id: `about-addressbook-confirm-${action}-title`, args: { count } },
      {
        id: `about-addressbook-confirm-${action}`,
        args: { count, name, list },
      },
    ]);

    // Finally, show our smart confirmation message, and act upon it!
    if (
      Services.prompt.confirmEx(
        window,
        title,
        message,
        Ci.nsIPromptService.STD_YES_NO_BUTTONS,
        null,
        null,
        null,
        null,
        {}
      ) !== 0
    ) {
      // Deletion cancelled by user.
      return;
    }

    // Delete cards from address books or mailing lists.
    this.cardsList.view.deleteSelectedCards();
  },

  _onContextMenu(event) {
    this._showContextMenu(event);
  },

  _showContextMenu(event) {
    let row;
    if (event.target == this.cardsList) {
      row = this.cardsList.getRowAtIndex(this.cardsList.currentIndex);
    } else {
      row = event.target.closest("ab-card-listrow, ab-table-card-listrow");
    }
    if (!row) {
      return;
    }
    if (!this.cardsList.selectedIndices.includes(row.index)) {
      this.cardsList.selectedIndex = row.index;
      // Re-fetch the row in case it was replaced.
      row = this.cardsList.getRowAtIndex(this.cardsList.currentIndex);
    }

    this.cardsList.focus();

    let writeMenuItem = document.getElementById("cardContextWrite");
    let writeMenu = document.getElementById("cardContextWriteMenu");
    let writeMenuSeparator = document.getElementById(
      "cardContextWriteSeparator"
    );
    let editItem = document.getElementById("cardContextEdit");
    if (this.cardsList.selectedIndices.length == 1) {
      let card = this.cardsList.view.getCardFromRow(
        this.cardsList.selectedIndex
      );
      if (card.isMailList) {
        writeMenuItem.hidden = writeMenuSeparator.hidden = false;
        writeMenu.hidden = true;
        editItem.hidden = true;
      } else {
        let addresses = card.emailAddresses;

        if (addresses.length == 0) {
          writeMenuItem.hidden = writeMenu.hidden = writeMenuSeparator.hidden = true;
        } else if (addresses.length == 1) {
          writeMenuItem.hidden = writeMenuSeparator.hidden = false;
          writeMenu.hidden = true;
        } else {
          while (writeMenu.menupopup.lastChild) {
            writeMenu.menupopup.lastChild.remove();
          }

          for (let address of addresses) {
            let menuitem = document.createXULElement("menuitem");
            menuitem.label = MailServices.headerParser.makeMimeAddress(
              card.displayName,
              address
            );
            menuitem.addEventListener("command", () =>
              this.writeTo([menuitem.label])
            );
            writeMenu.menupopup.appendChild(menuitem);
          }

          writeMenuItem.hidden = true;
          writeMenu.hidden = writeMenuSeparator.hidden = false;
        }

        editItem.hidden = !this._canModifySelected();
      }
    } else {
      writeMenuItem.hidden = false;
      writeMenu.hidden = true;
      editItem.hidden = true;
    }

    let deleteItem = document.getElementById("cardContextDelete");
    let removeItem = document.getElementById("cardContextRemove");

    let inMailList = this.cardsList.view.directory?.isMailList;
    deleteItem.hidden = inMailList;
    removeItem.hidden = !inMailList;
    deleteItem.disabled = removeItem.disabled = !this._canModifySelected();

    if (event.type == "contextmenu" && event.button == 2) {
      // This is a right-click. Open where it happened.
      this.cardContext.openPopupAtScreen(event.screenX, event.screenY, true);
    } else {
      // This is a context menu key press. Open near the middle of the row.
      this.cardContext.openPopup(row, {
        triggerEvent: event,
        position: "overlap",
        x: row.clientWidth / 2,
        y: row.clientHeight / 2,
      });
    }
    event.preventDefault();
  },

  _onCommand(event) {
    if (event.target == this.searchInput) {
      this.cardsList.view = new ABView(
        this.cardsList.view.directory,
        this.getQuery(),
        this.searchInput.value,
        this.cardsList.view.sortColumn,
        this.cardsList.view.sortDirection
      );
      this._updatePlaceholder();
      return;
    }

    switch (event.target.id) {
      case "sortContextTableLayout":
        this.toggleLayout(true);
        break;
      case "sortContextListLayout":
        this.toggleLayout(false);
        break;
      case "cardContextWrite":
        this.writeToSelected();
        return;
      case "cardContextEdit":
        detailsPane.editCurrentContact();
        return;
      case "cardContextPrint":
        this.printSelected();
        return;
      case "cardContextDelete":
        this.deleteSelected();
        return;
      case "cardContextRemove":
        this.deleteSelected();
        return;
    }

    if (event.target.getAttribute("name") == "format") {
      this.setNameFormat(event);
    }
    if (event.target.getAttribute("name") == "sort") {
      let [column, direction] = event.target.value.split(" ");
      this.sortCards(column, direction);
    }
    if (event.target.getAttribute("name") == "toggle") {
      let column = event.target.value;
      let checked = event.target.hasAttribute("checked");

      for (let columnDef of AbTableCardListrow.COLUMNS) {
        if (columnDef[0] == column) {
          columnDef[1] = checked;
          break;
        }
      }

      this.cardsHeader.querySelector(
        `.${column.toLowerCase()}-column`
      ).hidden = !checked;
      this.cardsList.invalidate();

      Services.xulStore.setValue(
        "about:addressbook",
        "cards",
        "columns",
        AbTableCardListrow.COLUMNS.filter(c => c[1])
          .map(c => c[0])
          .join(",")
      );
    }
  },

  _onClick(event) {
    if (event.target.closest("button") == this.sortButton) {
      this.sortContext.openPopup(this.sortButton, { triggerEvent: event });
      event.preventDefault();
      return;
    }

    let { sortColumn, sortDirection } = this.cardsList.view;

    let column = event.target.value;
    if (sortColumn == column && sortDirection == "ascending") {
      this.sortCards(column, "descending");
    } else {
      this.sortCards(column, "ascending");
    }
  },

  _onSelect(event) {
    detailsPane.displayCards(this.selectedCards);
  },

  _onKeyDown(event) {
    if (event.altKey || event.shiftKey) {
      return;
    }

    let modifier = event.ctrlKey;
    let antiModifier = event.metaKey;
    if (AppConstants.platform == "macosx") {
      [modifier, antiModifier] = [antiModifier, modifier];
    }
    if (antiModifier) {
      return;
    }

    switch (event.key) {
      case "a":
        if (modifier) {
          this.cardsList.view.selection.selectAll();
          this.cardsList.dispatchEvent(new CustomEvent("select"));
          event.preventDefault();
        }
        break;
      case "Delete":
        if (!modifier) {
          this.deleteSelected();
          event.preventDefault();
        }
        break;
      case "Enter":
        if (!modifier) {
          if (this.cardsList.currentIndex >= 0) {
            this._activateRow(this.cardsList.currentIndex);
          }
          event.preventDefault();
        }
        break;
    }
  },

  _onDoubleClick(event) {
    if (
      event.button != 0 ||
      event.ctrlKey ||
      event.metaKey ||
      event.shiftKey ||
      event.altKey
    ) {
      return;
    }
    let row = event.target.closest("ab-card-listrow, ab-table-card-listrow");
    if (row) {
      this._activateRow(row.index);
    }
    event.preventDefault();
  },

  /**
   * "Activate" the row by opening the corresponding card for editing. This will
   * necessarily change the selection to the given index.
   *
   * @param {number} index - The index of the row to activate.
   */
  _activateRow(index) {
    if (detailsPane.isEditing) {
      return;
    }
    // Change selection to just the target.
    this.cardsList.selectedIndex = index;
    // We expect the selection to change the detailsPane immediately.
    detailsPane.editCurrent();
  },

  _onDragStart(event) {
    function makeMimeAddressFromCard(card) {
      if (!card) {
        return "";
      }

      let email;
      if (card.isMailList) {
        let directory = MailServices.ab.getDirectory(card.mailListURI);
        email = directory.description || card.displayName;
      } else {
        email = card.emailAddresses[0];
      }
      if (!email) {
        return "";
      }
      return MailServices.headerParser.makeMimeAddress(card.displayName, email);
    }

    let row = event.target.closest("ab-card-listrow, ab-table-card-listrow");
    if (!row) {
      event.preventDefault();
      return;
    }

    let indices = this.cardsList.selectedIndices;
    if (indices.length === 0) {
      event.preventDefault();
      return;
    }
    let cards = indices.map(index => this.cardsList.view.getCardFromRow(index));

    let addresses = cards.map(makeMimeAddressFromCard);
    event.dataTransfer.mozSetDataAt("moz/abcard-array", cards, 0);
    event.dataTransfer.setData("text/x-moz-address", addresses);
    event.dataTransfer.setData("text/unicode", addresses);

    let card = this.cardsList.view.getCardFromRow(row.index);
    if (card && card.displayName && !card.isMailList) {
      try {
        // A card implementation may throw NS_ERROR_NOT_IMPLEMENTED.
        // Don't break drag-and-drop if that happens.
        let vCard = card.translateTo("vcard");
        event.dataTransfer.setData("text/vcard", decodeURIComponent(vCard));
        event.dataTransfer.setData(
          "application/x-moz-file-promise-dest-filename",
          card.displayName + ".vcf"
        );
        event.dataTransfer.setData(
          "application/x-moz-file-promise-url",
          "data:text/vcard," + vCard
        );
        event.dataTransfer.setData(
          "application/x-moz-file-promise",
          this._flavorDataProvider
        );
      } catch (ex) {
        Cu.reportError(ex);
      }
    }

    event.dataTransfer.effectAllowed = "all";
    let bcr = row.getBoundingClientRect();
    event.dataTransfer.setDragImage(
      row,
      event.clientX - bcr.x,
      event.clientY - bcr.y
    );
  },

  _flavorDataProvider: {
    QueryInterface: ChromeUtils.generateQI(["nsIFlavorDataProvider"]),

    getFlavorData(aTransferable, aFlavor, aData) {
      if (aFlavor == "application/x-moz-file-promise") {
        let primitive = {};
        aTransferable.getTransferData("text/vcard", primitive);
        let vCard = primitive.value.QueryInterface(Ci.nsISupportsString).data;
        aTransferable.getTransferData(
          "application/x-moz-file-promise-dest-filename",
          primitive
        );
        let leafName = primitive.value.QueryInterface(Ci.nsISupportsString)
          .data;
        aTransferable.getTransferData(
          "application/x-moz-file-promise-dir",
          primitive
        );
        let localFile = primitive.value.QueryInterface(Ci.nsIFile).clone();
        localFile.append(leafName);

        let ofStream = Cc[
          "@mozilla.org/network/file-output-stream;1"
        ].createInstance(Ci.nsIFileOutputStream);
        ofStream.init(localFile, -1, -1, 0);
        let converter = Cc[
          "@mozilla.org/intl/converter-output-stream;1"
        ].createInstance(Ci.nsIConverterOutputStream);
        converter.init(ofStream, null);
        converter.writeString(vCard);
        converter.close();

        aData.value = localFile;
      }
    },
  },
};

// Details

var detailsPane = {
  currentCard: null,

  dirtyFields: new Set(),

  _notifications: [
    "addrbook-contact-created",
    "addrbook-contact-updated",
    "addrbook-contact-deleted",
    "addrbook-list-updated",
    "addrbook-list-deleted",
  ],

  init() {
    this.splitter = document.getElementById("detailsSplitter");
    let splitterHeight = Services.xulStore.getValue(
      "about:addressbook",
      "detailsSplitter",
      "height"
    );
    if (splitterHeight) {
      this.splitter.height = splitterHeight;
    }
    this.splitter.addEventListener("splitter-resized", () =>
      Services.xulStore.setValue(
        "about:addressbook",
        "detailsSplitter",
        "height",
        this.splitter.height
      )
    );

    this.node = document.getElementById("detailsPane");
    this.actions = document.getElementById("detailsActions");
    this.writeButton = document.getElementById("detailsWriteButton");
    this.eventButton = document.getElementById("detailsEventButton");
    this.searchButton = document.getElementById("detailsSearchButton");
    this.newListButton = document.getElementById("detailsNewListButton");
    this.newListButton.textContent = document.getElementById(
      "toolbarCreateList"
    ).label;
    this.editButton = document.getElementById("editButton");
    this.form = document.getElementById("editContactForm");
    this.vCardEdit = this.form.querySelector("vcard-edit");
    this.deleteButton = document.getElementById("detailsDeleteButton");
    this.addContactBookList = document.getElementById("addContactBookList");
    this.cancelEditButton = document.getElementById("cancelEditButton");
    this.saveEditButton = document.getElementById("saveEditButton");

    this.actions.addEventListener("click", this);
    document.getElementById("detailsFooter").addEventListener("click", this);

    this.form.addEventListener("input", event => {
      let { type, checked, value, _originalValue } = event.target;
      let changed;
      if (type == "checkbox") {
        changed = checked != _originalValue;
      } else {
        changed = value != _originalValue;
      }
      if (changed) {
        this.dirtyFields.add(event.target);
      } else {
        this.dirtyFields.delete(event.target);
      }

      // If there are no dirty fields, clear the flag, otherwise set it.
      this.isDirty = this.dirtyFields.size > 0;
    });
    this.form.addEventListener("keypress", event => {
      // Prevent scrolling of the html tag when space is used on a button or
      // checkbox.
      if (
        event.key == " " &&
        ["button", "checkbox"].includes(document.activeElement.type)
      ) {
        event.preventDefault();
      }

      if (event.key != "Escape") {
        return;
      }

      event.preventDefault();
      this.form.reset();
    });
    this.form.addEventListener("reset", async event => {
      event.preventDefault();
      if (this.isDirty) {
        let [title, message] = await document.l10n.formatValues([
          { id: `about-addressbook-unsaved-changes-prompt-title` },
          { id: `about-addressbook-unsaved-changes-prompt` },
        ]);

        let buttonPressed = Services.prompt.confirmEx(
          window,
          title,
          message,
          Ci.nsIPrompt.BUTTON_TITLE_SAVE * Ci.nsIPrompt.BUTTON_POS_0 +
            Ci.nsIPrompt.BUTTON_TITLE_CANCEL * Ci.nsIPrompt.BUTTON_POS_1 +
            Ci.nsIPrompt.BUTTON_TITLE_DONT_SAVE * Ci.nsIPrompt.BUTTON_POS_2,
          null,
          null,
          null,
          null,
          {}
        );
        if (buttonPressed === 0) {
          // Don't call this.form.submit, the submit event won't fire.
          if (this.vCardEdit.checkFormValidity()) {
            this.saveCurrentContact();
          } else {
            this.handleInvalidForm();
          }
          return;
        } else if (buttonPressed === 1) {
          return;
        }
      }
      this.isEditing = false;
      if (this.currentCard) {
        // Refresh the card from the book to get exactly what was saved.
        let book = MailServices.ab.getDirectoryFromUID(
          this.currentCard.directoryUID
        );
        let card = book.childCards.find(c => c.UID == this.currentCard.UID);
        this.displayContact(card);
        if (this._focusOnCardsList) {
          cardsPane.cardsList.focus();
        } else {
          this.editButton.focus();
        }
      } else {
        this.displayCards(cardsPane.selectedCards);
        if (this._focusOnCardsList) {
          cardsPane.cardsList.focus();
        } else {
          cardsPane.searchInput.focus();
        }
      }
    });
    this.form.addEventListener("submit", event => {
      event.preventDefault();
      if (this.vCardEdit.checkFormValidity()) {
        this.saveCurrentContact();
      } else {
        this.handleInvalidForm();
      }
    });

    this.photoInput = document.getElementById("photoInput");
    // NOTE: We put the paste handler on the button parent because the
    // html:button will not be targeted by the paste event.
    this.photoInput.addEventListener("paste", photoDialog);
    this.photoInput.addEventListener("dragover", photoDialog);
    this.photoInput.addEventListener("drop", photoDialog);

    let photoButton = document.getElementById("photoButton");
    // FIXME: Remove this once we get new strings after 102.
    let stringBundle = Services.strings.createBundle(
      "chrome://messenger/locale/addressbook/addressBook.properties"
    );
    photoButton.title = stringBundle.GetStringFromName("browsePhoto");
    photoButton.addEventListener("click", () => {
      if (this._photoDetails.sourceURL) {
        photoDialog.showWithURL(
          this._photoDetails.sourceURL,
          this._photoDetails.cropRect,
          true
        );
      } else {
        photoDialog.showEmpty();
      }
    });

    for (let topic of this._notifications) {
      Services.obs.addObserver(this, topic);
    }
  },

  uninit() {
    for (let topic of this._notifications) {
      Services.obs.removeObserver(this, topic);
    }
  },

  handleEvent(event) {
    switch (event.type) {
      case "click":
        this._onClick(event);
        break;
    }
  },

  async observe(subject, topic, data) {
    switch (topic) {
      case "addrbook-contact-created":
        subject.QueryInterface(Ci.nsIAbCard);
        if (
          !this.currentCard ||
          this.currentCard.directoryUID != data ||
          subject.getProperty("_originalUID", "") != this.currentCard.UID
        ) {
          break;
        }

        // The card being displayed had its UID changed by the server. Select
        // the new card to display it. (If we're already editing the new card
        // when the server responds, that's just tough luck.)
        this.isEditing = false;
        cardsPane.cardsList.selectedIndex = cardsPane.cardsList.view.getIndexForUID(
          subject.UID
        );
        break;
      case "addrbook-contact-updated":
        subject.QueryInterface(Ci.nsIAbCard);
        if (
          !this.currentCard ||
          this.currentCard.directoryUID != data ||
          !subject.equals(this.currentCard)
        ) {
          break;
        }

        // If there's editing in progress, we could attempt to update the
        // editing interface with the changes, which is difficult, or alert
        // the user. For now, changes will be overwritten if the edit is saved.

        if (!this.isEditing) {
          this.displayContact(subject);
        }
        break;
      case "addrbook-contact-deleted":
        subject.QueryInterface(Ci.nsIAbCard);
        if (
          !this.currentCard ||
          this.currentCard.directoryUID != data ||
          !subject.equals(this.currentCard)
        ) {
          break;
        }

        // The card being displayed was deleted.
        this.isEditing = false;
        this.displayCards();
        // FIXME: Focus should remain on the cardsList if it is already there
        // and move to the next item.
        cardsPane.searchInput.focus();
        break;
      case "addrbook-list-updated":
        subject.QueryInterface(Ci.nsIAbDirectory);
        if (this.currentList && subject.URI == this.currentList.mailListURI) {
          this.displayList(this.currentList);
        }
        break;
      case "addrbook-list-deleted":
        subject.QueryInterface(Ci.nsIAbDirectory);
        if (this.currentList && subject.URI == this.currentList.mailListURI) {
          this.displayCards();
          cardsPane.searchInput.focus();
        }
        break;
    }
  },

  /**
   * Is a card being edited?
   * @type {boolean}
   */
  get isEditing() {
    return document.body.classList.contains("is-editing");
  },

  set isEditing(editing) {
    if (editing == this.isEditing) {
      return;
    }

    document.body.classList.toggle("is-editing", editing);

    // Disable the toolbar buttons when starting to edit. Remember their state
    // to restore it when editing stops.
    for (let toolbarButton of document.querySelectorAll(
      "#toolbox > toolbar > toolbarbutton"
    )) {
      if (editing) {
        toolbarButton._wasDisabled = toolbarButton.disabled;
        toolbarButton.disabled = true;
      } else {
        toolbarButton.disabled = toolbarButton._wasDisabled;
        delete toolbarButton._wasDisabled;
      }
    }

    // Remove these elements from (or add them back to) the tab focus cycle.
    for (let id of ["books", "searchInput", "sortButton", "cards"]) {
      document.getElementById(id).tabIndex = editing ? -1 : 0;
    }

    if (editing) {
      this.addContactBookList.hidden = !!this.currentCard;
      this.addContactBookList.previousElementSibling.hidden = !!this
        .currentCard;

      let book = booksList
        .getRowAtIndex(booksList.selectedIndex)
        .closest(".bookRow")._book;
      if (book) {
        // TODO: convert this to UID.
        this.addContactBookList.value = book.URI;
      }
    } else {
      this.isDirty = false;
    }
  },

  /**
   * If a card is being edited, has any field changed?
   * @type {boolean}
   */
  get isDirty() {
    return this.isEditing && document.body.classList.contains("is-dirty");
  },

  set isDirty(dirty) {
    if (!dirty) {
      this.dirtyFields.clear();
    }
    document.body.classList.toggle("is-dirty", this.isEditing && dirty);
  },

  clearDisplay() {
    this.currentCard = null;
    this.currentList = null;

    for (let section of document.querySelectorAll(
      "#viewContact .contact-header, #viewContact .list-header, #detailsBody > section"
    )) {
      section.hidden = true;
    }
  },

  displayCards(cards = []) {
    if (this.isEditing) {
      return;
    }

    this.clearDisplay();

    if (cards.length == 0) {
      this.node.hidden = this.splitter.isCollapsed = true;
      return;
    }
    if (cards.length == 1) {
      if (cards[0].isMailList) {
        this.displayList(cards[0]);
      } else {
        this.displayContact(cards[0]);
      }
      return;
    }

    // TODO: Add a heading when we can create new strings again.

    let contacts = cards.filter(c => !c.isMailList).filter(c => c.primaryEmail);
    let lists = cards.filter(c => c.isMailList);

    this.writeButton.hidden = contacts.length + lists.length == 0;
    this.eventButton.hidden =
      !contacts.length ||
      !cal.manager
        .getCalendars()
        .filter(cal.acl.isCalendarWritable)
        .filter(cal.acl.userCanAddItemsToCalendar).length;
    this.searchButton.hidden = true;
    this.newListButton.hidden = contacts.length == 0;
    this.editButton.hidden = true;

    this.actions.hidden = this.writeButton.hidden;

    let section = document.getElementById("selectedCards");
    let list = section.querySelector("ul");
    list.replaceChildren();
    let template = document.getElementById("selectedCard").content
      .firstElementChild;
    for (let card of cards) {
      let li = list.appendChild(template.cloneNode(true));
      let avatar = li.querySelector(".recipient-avatar");
      let name = li.querySelector(".name");
      let address = li.querySelector(".address");

      if (!card.isMailList) {
        name.textContent = card.generateName(ABView.nameFormat);
        address.textContent = card.primaryEmail;

        let photoURL = card.photoURL;
        if (photoURL) {
          let img = document.createElement("img");
          img.alt = name.textContent;
          img.src = photoURL;
          avatar.appendChild(img);
        } else {
          let letter = document.createElement("span");
          letter.textContent = Array.from(name.textContent)[0]?.toUpperCase();
          letter.setAttribute("aria-hidden", "true");
          avatar.appendChild(letter);
        }
      } else {
        name.textContent = card.displayName;

        let img = avatar.appendChild(document.createElement("img"));
        img.alt = "";
        img.src = "chrome://messenger/skin/icons/new/compact/user-list.svg";
        avatar.classList.add("is-mail-list");
      }
    }
    section.hidden = false;

    this.node.hidden = this.splitter.isCollapsed = false;
    document.getElementById("viewContact").scrollTo(0, 0);
  },

  /**
   * Show a read-only representation of a card in the details pane.
   *
   * @param {nsIAbCard?} card - The card to display. This should not be a
   *     mailing list card. Pass null to hide the details pane.
   */
  displayContact(card) {
    if (this.isEditing) {
      return;
    }

    this.clearDisplay();
    if (!card || card.isMailList) {
      return;
    }
    this.currentCard = card;

    document.querySelector("#viewContact .contact-header").hidden = false;
    document.getElementById("viewContactName").textContent = card.generateName(
      ABView.nameFormat
    );
    document.getElementById("viewPrimaryEmail").textContent = card.primaryEmail;

    document.getElementById("viewContactPhoto").src =
      card.photoURL || "chrome://messenger/skin/icons/contact.svg";

    // TODO no!
    document.getElementById("viewContactPhoto").hidden = document.querySelector(
      "#viewContact .contact-headings"
    ).hidden = false;

    this.writeButton.hidden = this.searchButton.hidden = !card.primaryEmail;
    this.eventButton.hidden =
      !card.primaryEmail ||
      !cal.manager
        .getCalendars()
        .filter(cal.acl.isCalendarWritable)
        .filter(cal.acl.userCanAddItemsToCalendar).length;
    this.newListButton.hidden = true;

    let book = MailServices.ab.getDirectoryFromUID(card.directoryUID);
    this.editButton.hidden = book.readOnly;
    this.actions.hidden = this.writeButton.hidden && this.editButton.hidden;

    let vCardProperties = card.supportsVCard
      ? card.vCardProperties
      : VCardProperties.fromPropertyMap(
          new Map(card.properties.map(p => [p.name, p.value]))
        );

    let nickname = document.getElementById("viewContactNickName");
    let nicknameValue = vCardProperties.getFirstValue("nickname");
    nickname.hidden = !nicknameValue;
    nickname.textContent = nicknameValue;

    let template = document.getElementById("entryItem");
    let createEntryItem = function(name) {
      let li = template.content.firstElementChild.cloneNode(true);
      if (name) {
        document.l10n.setAttributes(
          li.querySelector(".entry-type"),
          `about-addressbook-entry-name-${name}`
        );
      }
      return li;
    };
    let setEntryType = function(li, entry, allowed = ["work", "home"]) {
      if (!entry.params.type) {
        return;
      }
      let lowerTypes = Array.isArray(entry.params.type)
        ? entry.params.type.map(t => t.toLowerCase())
        : [entry.params.type.toLowerCase()];
      let lowerType = lowerTypes.find(t => allowed.includes(t));
      if (!lowerType) {
        return;
      }

      document.l10n.setAttributes(
        li.querySelector(".entry-type"),
        `about-addressbook-entry-type-${lowerType}`
      );
    };

    let section = document.getElementById("emailAddresses");
    let list = section.querySelector("ul");
    list.replaceChildren();
    for (let entry of vCardProperties.getAllEntries("email")) {
      let li = list.appendChild(createEntryItem());
      setEntryType(li, entry);
      let addr = MailServices.headerParser.makeMimeAddress(
        card.displayName,
        entry.value
      );
      let a = document.createElement("a");
      a.href = "mailto:" + encodeURIComponent(addr);
      a.textContent = entry.value;
      li.querySelector(".entry-value").appendChild(a);
    }
    section.hidden = list.childElementCount == 0;

    section = document.getElementById("phoneNumbers");
    list = section.querySelector("ul");
    list.replaceChildren();
    for (let entry of vCardProperties.getAllEntries("tel")) {
      let li = list.appendChild(createEntryItem());
      setEntryType(li, entry, ["work", "home", "fax", "cell", "pager"]);
      li.querySelector(".entry-value").textContent = entry.value.replace(
        /^tel:/,
        ""
      );
    }
    section.hidden = list.childElementCount == 0;

    section = document.getElementById("addresses");
    list = section.querySelector("ul");
    list.replaceChildren();
    for (let entry of vCardProperties.getAllEntries("adr")) {
      let parts = [];
      for (let part of entry.value) {
        if (Array.isArray(part)) {
          parts.push(...part);
        } else {
          parts.push(part);
        }
      }

      let li = list.appendChild(createEntryItem());
      setEntryType(li, entry);
      let span = li.querySelector(".entry-value");
      for (let part of parts.filter(Boolean)) {
        if (span.firstChild) {
          span.appendChild(document.createElement("br"));
        }
        span.appendChild(document.createTextNode(part));
      }
    }
    section.hidden = list.childElementCount == 0;

    section = document.getElementById("notes");
    let note = vCardProperties.getFirstValue("note");
    if (note) {
      section.querySelector("div").textContent = note;
      section.hidden = false;
    } else {
      section.hidden = true;
    }

    section = document.getElementById("websites");
    list = section.querySelector("ul");
    list.replaceChildren();

    for (let entry of vCardProperties.getAllEntries("url")) {
      let value = entry.value;
      if (/^https?\\:/.test(value)) {
        // Google escapes some characters in violation of RFC6350. A backslash
        // wouldn't be expected in a URL so removing them shouldn't be a problem.
        value = value.replace(/\\(.)/g, "$1");
      }
      if (!/https?:\/\//.test(value)) {
        continue;
      }

      let li = list.appendChild(createEntryItem());
      setEntryType(li, entry);
      let a = document.createElement("a");
      a.href = value;
      let url = new URL(value);
      a.textContent =
        url.pathname == "/" && !url.search
          ? url.host
          : `${url.host}${url.pathname}${url.search}`;
      li.querySelector(".entry-value").appendChild(a);
    }
    section.hidden = list.childElementCount == 0;

    section = document.getElementById("otherInfo");
    list = section.querySelector("ul");
    list.replaceChildren();

    let formatDate = function(date) {
      date = ICAL.VCardTime.fromDateAndOrTimeString(date);
      if (date.year) {
        if (date.month && date.day) {
          return new Services.intl.DateTimeFormat(
            Services.locale.appLocalesAsBCP47,
            { month: "long", day: "numeric", year: "numeric" }
          ).format(new Date(date.year, date.month - 1, date.day));
        }
        return date.year;
      } else if (date.month && date.day) {
        return new Services.intl.DateTimeFormat(
          Services.locale.appLocalesAsBCP47,
          { month: "long", day: "numeric" }
        ).format(new Date(2022, date.month - 1, date.day));
      }
      return "";
    };

    let bday = vCardProperties.getFirstValue("bday");
    if (bday) {
      let value = formatDate(bday);
      if (value) {
        let li = list.appendChild(createEntryItem("birthday"));
        li.querySelector(".entry-value").textContent = value;
      }
    }

    let anniversary = vCardProperties.getFirstValue("anniversary");
    if (anniversary) {
      let value = formatDate(anniversary);
      if (value) {
        let li = list.appendChild(createEntryItem("anniversary"));
        li.querySelector(".entry-value").textContent = value;
      }
    }

    let title = vCardProperties.getFirstValue("title");
    if (title) {
      let li = list.appendChild(createEntryItem("title"));
      li.querySelector(".entry-value").textContent = title;
    }

    let role = vCardProperties.getFirstValue("role");
    if (role) {
      let li = list.appendChild(createEntryItem("role"));
      li.querySelector(".entry-value").textContent = role;
    }

    let org = vCardProperties.getFirstValue("org");
    if (Array.isArray(org)) {
      let li = list.appendChild(createEntryItem("organization"));
      let span = li.querySelector(".entry-value");
      for (let part of org.filter(Boolean).reverse()) {
        if (span.firstChild) {
          span.appendChild(document.createElement("br"));
        }
        span.appendChild(document.createTextNode(part));
      }
    } else if (org) {
      let li = list.appendChild(createEntryItem("organization"));
      li.querySelector(".entry-value").textContent = org;
    }

    let tz = vCardProperties.getFirstValue("tz");
    if (tz) {
      let li = list.appendChild(createEntryItem("time-zone"));
      try {
        li.querySelector(
          ".entry-value"
        ).textContent = cal.timezoneService.getTimezone(tz).displayName;
      } catch {
        li.querySelector(".entry-value").textContent = tz;
      }
      li.querySelector(".entry-value").appendChild(
        document.createElement("br")
      );

      let time = document.createElement("span", { is: "active-time" });
      time.setAttribute("tz", tz);
      li.querySelector(".entry-value").appendChild(time);
    }
    section.hidden = list.childElementCount == 0;

    this.isEditing = false;
    this.node.hidden = this.splitter.isCollapsed = false;
    document.getElementById("viewContact").scrollTo(0, 0);
  },

  /**
   * Show this given contact photo in the edit form.
   *
   * @param {?string} url - The URL of the photo to display, or null to
   *   display none.
   */
  showEditPhoto(url) {
    this.photoInput.querySelector(".contact-photo").src =
      url || "chrome://messenger/skin/icons/contact.svg";
  },

  /**
   * Store the given photo details to save later, and display the photo in the
   * edit form.
   *
   * @param {?object} details - The photo details to save, or null to remove the
   *   photo.
   * @param {Blob} details.blob - The image blob of the photo to save.
   * @param {string} details.sourceURL - The image basis of the photo, before
   *   cropping.
   * @param {DOMRect} details.cropRect - The cropping rectangle for the photo.
   */
  setPhoto(details) {
    this._photoChanged = true;
    this._photoDetails = details || {};
    this.showEditPhoto(
      details?.blob ? URL.createObjectURL(details.blob) : null
    );
    this.dirtyFields.add(this.photoInput);
    this.isDirty = true;
  },

  /**
   * Show controls for editing a new card.
   *
   * @param {?string} vCard - A vCard containing properties for the new card.
   */
  async editNewContact(vCard) {
    this.currentCard = null;
    this.editCurrentContact(vCard);
  },

  /**
   * Show controls for editing the currently displayed card.
   *
   * @param {?string} vCard - A vCard containing properties for a new card.
   */
  editCurrentContact(vCard) {
    let card = this.currentCard;

    if (card && card.supportsVCard) {
      this.vCardEdit.vCardProperties = card.vCardProperties;
      // getProperty may return a "1" or "0" string, we want a boolean.
      this.vCardEdit.preferDisplayName.checked =
        // eslint-disable-next-line mozilla/no-compare-against-boolean-literals
        card.getProperty("PreferDisplayName", true) == true;
    } else {
      this.vCardEdit.vCardString = vCard ?? "";
    }
    this.showEditPhoto(card?.photoURL);
    this._photoDetails = { sourceURL: card?.photoURL };
    this._photoChanged = false;

    this.deleteButton.hidden = !card;

    this.isEditing = true;
    this.node.hidden = this.splitter.isCollapsed = false;
    this.form.querySelector(".contact-details-scroll").scrollTo(0, 0);
    // If we enter editing directly from the cards list we want to return to it
    // once we are done.
    this._focusOnCardsList = document.activeElement == cardsPane.cardsList;
    this.vCardEdit.setFocus();
  },

  /**
   * Edit the currently displayed contact or list.
   */
  editCurrent() {
    // The editButton is disabled if the book is readOnly.
    if (this.editButton.hidden) {
      return;
    }
    if (this.currentCard) {
      this.editCurrentContact();
    } else if (this.currentList) {
      SubDialog.open(
        "chrome://messenger/content/addressbook/abEditListDialog.xhtml",
        { features: "resizable=no" },
        { listURI: this.currentList.mailListURI }
      );
    }
  },

  /**
   * Properly handle a failed form validation.
   */
  handleInvalidForm() {
    // FIXME: Drop this in favor of an inline notification with fluent strings.
    let stringBundle = Services.strings.createBundle(
      "chrome://messenger/locale/addressbook/addressBook.properties"
    );
    Services.prompt.alert(
      window,
      stringBundle.GetStringFromName("cardRequiredDataMissingTitle"),
      stringBundle.GetStringFromName("cardRequiredDataMissingMessage")
    );
  },

  /**
   * Save the currently displayed card.
   */
  async saveCurrentContact() {
    let card = this.currentCard;
    let book;

    if (card) {
      book = MailServices.ab.getDirectoryFromUID(card.directoryUID);
    } else {
      card = new AddrBookCard();

      // TODO: convert this to UID.
      book = MailServices.ab.getDirectory(this.addContactBookList.value);
      if (book.getBoolValue("carddav.vcard3", false)) {
        // This is a CardDAV book, and the server discards photos unless the
        // vCard 3 format is used. Since we know this is a new card, setting
        // the version here won't cause a problem.
        this.vCardEdit.vCardProperties.addValue("version", "3.0");
      }
    }
    if (!book || book.readOnly) {
      throw new Components.Exception(
        "Address book is read-only",
        Cr.NS_ERROR_FAILURE
      );
    }

    // Tell vcard-edit to read the input fields. Setting the _vCard property
    // MUST happen before accessing `card.vCardProperties` or creating new
    // cards will fail.
    this.vCardEdit.saveVCard();
    card.setProperty("_vCard", this.vCardEdit.vCardString);
    card.setProperty(
      "PreferDisplayName",
      this.vCardEdit.preferDisplayName.checked
    );

    // No photo or a new photo. Delete the old one.
    if (this._photoChanged) {
      let oldLeafName = card.getProperty("PhotoName", "");
      if (oldLeafName) {
        let oldPath = PathUtils.join(
          PathUtils.profileDir,
          "Photos",
          oldLeafName
        );
        IOUtils.remove(oldPath);

        card.setProperty("PhotoName", "");
        card.setProperty("PhotoType", "");
        card.setProperty("PhotoURI", "");
      }
      if (card.supportsVCard) {
        for (let entry of card.vCardProperties.getAllEntries("photo")) {
          card.vCardProperties.removeEntry(entry);
        }
      }
    }

    // Save the new photo.
    if (this._photoChanged && this._photoDetails.blob) {
      if (book.dirType == Ci.nsIAbManager.CARDDAV_DIRECTORY_TYPE) {
        let reader = new FileReader();
        await new Promise(resolve => {
          reader.onloadend = resolve;
          reader.readAsDataURL(this._photoDetails.blob);
        });
        if (card.vCardProperties.getFirstValue("version") == "4.0") {
          card.vCardProperties.addEntry(
            new VCardPropertyEntry("photo", {}, "uri", reader.result)
          );
        } else {
          card.vCardProperties.addEntry(
            new VCardPropertyEntry(
              "photo",
              { encoding: "B" },
              "binary",
              reader.result.substring(reader.result.indexOf(",") + 1)
            )
          );
        }
      } else {
        let leafName = `${AddrBookUtils.newUID()}.jpg`;
        let path = PathUtils.join(PathUtils.profileDir, "Photos", leafName);
        let buffer = await this._photoDetails.blob.arrayBuffer();
        await IOUtils.write(path, new Uint8Array(buffer));
        card.setProperty("PhotoName", leafName);
      }
    }
    this._photoChanged = false;

    this.isEditing = false;

    if (!card.directoryUID) {
      card = book.addCard(card);
      cardsPane.cardsList.selectedIndex = cardsPane.cardsList.view.getIndexForUID(
        card.UID
      );
      // The selection change will update the UI.
    } else {
      book.modifyCard(card);
      // The addrbook-contact-updated notification will update the UI.
    }

    if (this._focusOnCardsList) {
      cardsPane.cardsList.focus();
    } else {
      this.editButton.focus();
    }
  },

  /**
   * Delete the currently displayed card.
   */
  async deleteCurrentContact() {
    let card = this.currentCard;
    let book = MailServices.ab.getDirectoryFromUID(card.directoryUID);

    if (!book) {
      throw new Components.Exception(
        "Card doesn't have a book to delete from",
        Cr.NS_ERROR_FAILURE
      );
    }

    if (book.readOnly) {
      throw new Components.Exception(
        "Address book is read-only",
        Cr.NS_ERROR_FAILURE
      );
    }

    let name = card.displayName;
    let [title, message] = await document.l10n.formatValues([
      {
        id: "about-addressbook-confirm-delete-contacts-title",
        args: { count: 1 },
      },
      {
        id: "about-addressbook-confirm-delete-contacts",
        args: { name, count: 1 },
      },
    ]);

    if (
      Services.prompt.confirmEx(
        window,
        title,
        message,
        Ci.nsIPromptService.STD_YES_NO_BUTTONS,
        null,
        null,
        null,
        null,
        {}
      ) === 0
    ) {
      book.deleteCards([card]);
      // The addrbook-contact-deleted notification will update the UI.
    }
  },

  displayList(listCard) {
    if (this.isEditing) {
      return;
    }

    this.clearDisplay();
    if (!listCard || !listCard.isMailList) {
      return;
    }
    this.currentList = listCard;

    let listDirectory = MailServices.ab.getDirectory(listCard.mailListURI);

    document.querySelector("#viewContact .list-header").hidden = false;
    document.querySelector(
      "#viewContact .list-header > h1"
    ).textContent = `${listDirectory.dirName}`;

    let cards = Array.from(listDirectory.childCards, card => {
      return {
        name: card.generateName(ABView.nameFormat),
        email: card.primaryEmail,
        photoURL: card.photoURL,
      };
    });
    let { sortColumn, sortDirection } = cardsPane.cardsList.view;
    let key = sortColumn == "EmailAddresses" ? "email" : "name";
    cards.sort((a, b) => {
      if (sortDirection == "descending") {
        [b, a] = [a, b];
      }
      return ABView.prototype.collator.compare(a[key], b[key]);
    });

    let section = document.getElementById("selectedCards");
    let list = section.querySelector("ul");
    list.replaceChildren();
    let template = document.getElementById("selectedCard").content
      .firstElementChild;
    for (let card of cards) {
      let li = list.appendChild(template.cloneNode(true));
      let avatar = li.querySelector(".recipient-avatar");
      let name = li.querySelector(".name");
      let address = li.querySelector(".address");
      name.textContent = card.name;
      address.textContent = card.email;

      let photoURL = card.photoURL;
      if (photoURL) {
        let img = document.createElement("img");
        img.alt = name.textContent;
        img.src = photoURL;
        avatar.appendChild(img);
      } else {
        let letter = document.createElement("span");
        letter.textContent = Array.from(name.textContent)[0]?.toUpperCase();
        letter.setAttribute("aria-hidden", "true");
        avatar.appendChild(letter);
      }
    }
    section.hidden = list.childElementCount == 0;

    let book = MailServices.ab.getDirectoryFromUID(listCard.directoryUID);
    this.writeButton.hidden = list.childElementCount == 0;
    this.eventButton.hidden = this.writeButton.hidden;
    this.searchButton.hidden = true;
    this.newListButton.hidden = true;
    this.editButton.hidden = book.readOnly;

    this.actions.hidden = this.writeButton.hidden && this.editButton.hidden;

    this.node.hidden = this.splitter.isCollapsed = false;
    document.getElementById("viewContact").scrollTo(0, 0);
  },

  _onClick(event) {
    let selectedContacts = cardsPane.selectedCards.filter(
      card => !card.isMailList && card.primaryEmail
    );

    switch (event.target.id) {
      case "detailsWriteButton":
        cardsPane.writeToSelected();
        break;
      case "detailsEventButton": {
        let contacts;
        if (this.currentList) {
          let directory = MailServices.ab.getDirectory(
            this.currentList.mailListURI
          );
          contacts = directory.childCards;
        } else {
          contacts = selectedContacts;
        }
        let attendees = contacts.map(card => {
          let attendee = new CalAttendee();
          attendee.id = `mailto:${card.primaryEmail}`;
          attendee.commonName = card.displayName;
          return attendee;
        });
        if (attendees.length) {
          window.browsingContext.topChromeWindow.createEventWithDialog(
            null,
            null,
            null,
            null,
            null,
            false,
            attendees
          );
        }
        break;
      }
      case "detailsSearchButton":
        if (this.currentCard.primaryEmail) {
          let searchString = this.currentCard.emailAddresses.join(" ");
          window.browsingContext.topChromeWindow.tabmail.openTab("glodaFacet", {
            searcher: new GlodaMsgSearcher(null, searchString, false),
          });
        }
        break;
      case "detailsNewListButton":
        if (selectedContacts.length) {
          createList(selectedContacts);
        }
        break;
      case "editButton":
        this.editCurrent();
        break;
      case "detailsDeleteButton":
        this.deleteCurrentContact();
        break;
    }
  },
};

var photoDialog = {
  /**
   * The ratio of pixels in the source image to pixels in the preview.
   *
   * @type {number}
   */
  _scale: null,

  /**
   * The square to which the image will be cropped, in preview pixels.
   *
   * @type {DOMRect}
   */
  _cropRect: null,

  /**
   * The bounding rectangle of the image in the preview, in preview pixels.
   * Cached for efficiency.
   *
   * @type {DOMRect}
   */
  _previewRect: null,

  init() {
    this._dialog = document.getElementById("photoDialog");
    this._dialog.saveButton = this._dialog.querySelector(".accept");
    this._dialog.cancelButton = this._dialog.querySelector(".cancel");
    this._dialog.discardButton = this._dialog.querySelector(".extra1");

    this._dropTarget = this._dialog.querySelector("#photoDropTarget");
    this._svg = this._dialog.querySelector("svg");
    this._preview = this._svg.querySelector("image");
    this._cropMask = this._svg.querySelector("path");
    this._dragRect = this._svg.querySelector("rect");
    this._corners = this._svg.querySelectorAll("rect.corner");

    this._dialog.addEventListener("dragover", this);
    this._dialog.addEventListener("drop", this);
    this._dialog.addEventListener("paste", this);
    this._dropTarget.addEventListener("click", event => {
      if (event.button != 0) {
        return;
      }
      this._showFilePicker();
    });
    this._dropTarget.addEventListener("keydown", event => {
      if (event.key != " " && event.key != "Enter") {
        return;
      }
      this._showFilePicker();
    });

    class Mover {
      constructor(element) {
        element.addEventListener("mousedown", this);
      }

      handleEvent(event) {
        if (event.type == "mousedown") {
          if (event.buttons != 1) {
            return;
          }
          this.onMouseDown(event);
          window.addEventListener("mousemove", this);
          window.addEventListener("mouseup", this);
        } else if (event.type == "mousemove") {
          if (event.buttons != 1) {
            // The button was released and we didn't get a mouseup event, or the
            // button(s) pressed changed. Either way, stop dragging.
            this.onMouseUp();
            return;
          }
          this.onMouseMove(event);
        } else {
          this.onMouseUp(event);
        }
      }

      onMouseUp(event) {
        delete this._dragPosition;
        window.removeEventListener("mousemove", this);
        window.removeEventListener("mouseup", this);
      }
    }

    new (class extends Mover {
      onMouseDown(event) {
        this._dragPosition = {
          x: event.clientX - photoDialog._cropRect.x,
          y: event.clientY - photoDialog._cropRect.y,
        };
      }

      onMouseMove(event) {
        photoDialog._cropRect.x = Math.min(
          Math.max(0, event.clientX - this._dragPosition.x),
          photoDialog._previewRect.width - photoDialog._cropRect.width
        );
        photoDialog._cropRect.y = Math.min(
          Math.max(0, event.clientY - this._dragPosition.y),
          photoDialog._previewRect.height - photoDialog._cropRect.height
        );
        photoDialog._redrawCropRect();
      }
    })(this._dragRect);

    class CornerMover extends Mover {
      constructor(element, xEdge, yEdge) {
        super(element);
        this.xEdge = xEdge;
        this.yEdge = yEdge;
      }

      onMouseDown(event) {
        this._dragPosition = {
          x: event.clientX - photoDialog._cropRect[this.xEdge],
          y: event.clientY - photoDialog._cropRect[this.yEdge],
        };
      }

      onMouseMove(event) {
        let { width, height } = photoDialog._previewRect;
        let { top, right, bottom, left } = photoDialog._cropRect;
        let { x, y } = this._dragPosition;

        // New coordinates of the dragged corner, constrained to the image size.
        x = Math.max(0, Math.min(width, event.clientX - x));
        y = Math.max(0, Math.min(height, event.clientY - y));

        // New size based on the dragged corner and a minimum size of 80px.
        let newWidth = this.xEdge == "right" ? x - left : right - x;
        let newHeight = this.yEdge == "bottom" ? y - top : bottom - y;
        let newSize = Math.max(80, Math.min(newWidth, newHeight));

        photoDialog._cropRect.width = newSize;
        if (this.xEdge == "left") {
          photoDialog._cropRect.x = right - photoDialog._cropRect.width;
        }
        photoDialog._cropRect.height = newSize;
        if (this.yEdge == "top") {
          photoDialog._cropRect.y = bottom - photoDialog._cropRect.height;
        }
        photoDialog._redrawCropRect();
      }
    }

    new CornerMover(this._corners[0], "left", "top");
    new CornerMover(this._corners[1], "right", "top");
    new CornerMover(this._corners[2], "right", "bottom");
    new CornerMover(this._corners[3], "left", "bottom");

    this._dialog.saveButton.addEventListener("click", () => this._save());
    this._dialog.cancelButton.addEventListener("click", () => this._cancel());
    this._dialog.discardButton.addEventListener("click", () => this._discard());
  },

  _setState(state) {
    if (state == "preview") {
      this._dropTarget.hidden = true;
      this._svg.toggleAttribute("hidden", false);
      this._dialog.saveButton.disabled = false;
      return;
    }

    this._dropTarget.classList.toggle("drop-target", state == "target");
    this._dropTarget.classList.toggle("drop-loading", state == "loading");
    this._dropTarget.classList.toggle("drop-error", state == "error");
    document.l10n.setAttributes(
      this._dropTarget.querySelector(".label"),
      `about-addressbook-photo-drop-${state}`
    );

    this._dropTarget.hidden = false;
    this._svg.toggleAttribute("hidden", true);
    this._dialog.saveButton.disabled = true;
  },

  /**
   * Show the photo dialog, with no displayed image.
   */
  showEmpty() {
    this._setState("target");

    if (!this._dialog.open) {
      this._dialog.discardButton.hidden = true;
      this._dialog.showModal();
    }
  },

  /**
   * Show the photo dialog, with `file` as the displayed image.
   *
   * @param {File} file
   */
  showWithFile(file) {
    this.showWithURL(URL.createObjectURL(file));
  },

  /**
   * Show the photo dialog, with `URL` as the displayed image and (optionally)
   * a pre-set crop rectangle
   *
   * @param {string} url - The URL of the image.
   * @param {?DOMRect} cropRect - The rectangle used to crop the image.
   * @param {boolean} [showDiscard=false] - Whether to show a discard button
   *   when opening the dialog.
   */
  showWithURL(url, cropRect, showDiscard = false) {
    // Load the image from the URL, to figure out the scale factor.
    let img = document.createElement("img");
    img.addEventListener("load", () => {
      const PREVIEW_SIZE = 500;

      let { naturalWidth, naturalHeight } = img;
      this._scale = Math.max(
        1,
        img.naturalWidth / PREVIEW_SIZE,
        img.naturalHeight / PREVIEW_SIZE
      );

      let previewWidth = naturalWidth / this._scale;
      let previewHeight = naturalHeight / this._scale;
      let smallDimension = Math.min(previewWidth, previewHeight);

      this._previewRect = new DOMRect(0, 0, previewWidth, previewHeight);
      if (cropRect) {
        this._cropRect = DOMRect.fromRect(cropRect);
      } else {
        this._cropRect = new DOMRect(
          (this._previewRect.width - smallDimension) / 2,
          (this._previewRect.height - smallDimension) / 2,
          smallDimension,
          smallDimension
        );
      }

      this._preview.setAttribute("href", url);
      this._preview.setAttribute("width", previewWidth);
      this._preview.setAttribute("height", previewHeight);

      this._svg.setAttribute("width", previewWidth + 20);
      this._svg.setAttribute("height", previewHeight + 20);
      this._svg.setAttribute(
        "viewBox",
        `-10 -10 ${previewWidth + 20} ${previewHeight + 20}`
      );

      this._redrawCropRect();
      this._setState("preview");
      this._dialog.saveButton.focus();
    });
    img.addEventListener("error", () => this._setState("error"));
    img.src = url;

    this._setState("loading");

    if (!this._dialog.open) {
      this._dialog.discardButton.hidden = !showDiscard;
      this._dialog.showModal();
    }
  },

  /**
   * Resize the crop controls to match the current _cropRect.
   */
  _redrawCropRect() {
    let { top, right, bottom, left, width, height } = this._cropRect;

    this._cropMask.setAttribute(
      "d",
      `M0 0H${this._previewRect.width}V${this._previewRect.height}H0Z M${left} ${top}V${bottom}H${right}V${top}Z`
    );

    this._dragRect.setAttribute("x", left);
    this._dragRect.setAttribute("y", top);
    this._dragRect.setAttribute("width", width);
    this._dragRect.setAttribute("height", height);

    this._corners[0].setAttribute("x", left - 10);
    this._corners[0].setAttribute("y", top - 10);
    this._corners[1].setAttribute("x", right - 30);
    this._corners[1].setAttribute("y", top - 10);
    this._corners[2].setAttribute("x", right - 30);
    this._corners[2].setAttribute("y", bottom - 30);
    this._corners[3].setAttribute("x", left - 10);
    this._corners[3].setAttribute("y", bottom - 30);
  },

  /**
   * Crop, shrink, convert the image to a JPEG, then assign it to the photo
   * element and close the dialog. Doesn't save the JPEG to disk, that happens
   * when (if) the contact is saved.
   */
  async _save() {
    const DOUBLE_SIZE = 600;
    const FINAL_SIZE = 300;

    let source = this._preview;
    let { x, y, width, height } = this._cropRect;
    x *= this._scale;
    y *= this._scale;
    width *= this._scale;
    height *= this._scale;

    // If the image is much larger than our target size, draw an intermediate
    // version at twice the size first. This produces better-looking results.
    if (width > DOUBLE_SIZE) {
      let canvas1 = document.createElement("canvas");
      canvas1.width = canvas1.height = DOUBLE_SIZE;
      let context1 = canvas1.getContext("2d");
      context1.drawImage(
        source,
        x,
        y,
        width,
        height,
        0,
        0,
        DOUBLE_SIZE,
        DOUBLE_SIZE
      );

      source = canvas1;
      x = y = 0;
      width = height = DOUBLE_SIZE;
    }

    let canvas2 = document.createElement("canvas");
    canvas2.width = canvas2.height = FINAL_SIZE;
    let context2 = canvas2.getContext("2d");
    context2.drawImage(
      source,
      x,
      y,
      width,
      height,
      0,
      0,
      FINAL_SIZE,
      FINAL_SIZE
    );

    let blob = await new Promise(resolve =>
      canvas2.toBlob(resolve, "image/jpeg")
    );

    detailsPane.setPhoto({
      blob,
      sourceURL: this._preview.getAttribute("href"),
      cropRect: DOMRect.fromRect(this._cropRect),
    });

    this._dialog.close();
  },

  /**
   * Just close the dialog.
   */
  _cancel() {
    this._dialog.close();
  },

  /**
   * Throw away the contact's existing photo, and close the dialog. Doesn't
   * remove the existing photo from disk, that happens when (if) the contact
   * is saved.
   */
  _discard() {
    this._dialog.close();
    detailsPane.setPhoto(null);
  },

  handleEvent(event) {
    switch (event.type) {
      case "dragover":
        this._onDragOver(event);
        break;
      case "drop":
        this._onDrop(event);
        break;
      case "paste":
        this._onPaste(event);
        break;
    }
  },

  /**
   * Gets the first image file from a DataTransfer object, or null if there
   * are no image files in the object.
   *
   * @param {DataTransfer} dataTransfer
   * @return {File|null}
   */
  _getUseableFile(dataTransfer) {
    if (
      dataTransfer.files.length &&
      dataTransfer.files[0].type.startsWith("image/")
    ) {
      return dataTransfer.files[0];
    }
    return null;
  },

  /**
   * Gets the first image file from a DataTransfer object, or null if there
   * are no image files in the object.
   *
   * @param {DataTransfer} dataTransfer
   * @return {string|null}
   */
  _getUseableURL(dataTransfer) {
    let data =
      dataTransfer.getData("text/plain") ||
      dataTransfer.getData("text/unicode");

    return /^https?:\/\//.test(data) ? data : null;
  },

  _onDragOver(event) {
    if (
      this._getUseableFile(event.dataTransfer) ||
      this._getUseableURL(event.clipboardData)
    ) {
      event.dataTransfer.dropEffect = "move";
      event.preventDefault();
    }
  },

  _onDrop(event) {
    let file = this._getUseableFile(event.dataTransfer);
    if (file) {
      this.showWithFile(file);
      event.preventDefault();
    } else {
      let url = this._getUseableURL(event.clipboardData);
      if (url) {
        this.showWithURL(url);
        event.preventDefault();
      }
    }
  },

  _onPaste(event) {
    let file = this._getUseableFile(event.clipboardData);
    if (file) {
      this.showWithFile(file);
    } else {
      let url = this._getUseableURL(event.clipboardData);
      if (url) {
        this.showWithURL(url);
      }
    }
    event.preventDefault();
  },

  /**
   * Show a file picker to choose an image.
   */
  async _showFilePicker() {
    let title = await document.l10n.formatValue(
      "about-addressbook-photo-filepicker-title"
    );

    let picker = Cc["@mozilla.org/filepicker;1"].createInstance(
      Ci.nsIFilePicker
    );
    picker.init(
      window.browsingContext.topChromeWindow,
      title,
      Ci.nsIFilePicker.modeOpen
    );
    picker.appendFilters(Ci.nsIFilePicker.filterImages);
    let result = await new Promise(resolve => picker.open(resolve));

    if (result != Ci.nsIFilePicker.returnOK) {
      return;
    }

    this.showWithFile(await File.createFromNsIFile(picker.file));
  },
};

// Printing

var printHandler = {
  printDirectory(directory) {
    let title = directory ? directory.dirName : document.title;

    let cards;
    if (directory) {
      cards = directory.childCards;
    } else {
      cards = [];
      for (let directory of MailServices.ab.directories) {
        cards = cards.concat(directory.childCards);
      }
    }

    this._printCards(title, cards);
  },

  printCards(cards) {
    this._printCards(document.title, cards);
  },

  _printCards(title, cards) {
    let collator = new Intl.Collator(undefined, { numeric: true });
    let nameFormat = Services.prefs.getIntPref(
      "mail.addr_book.lastnamefirst",
      0
    );

    cards.sort((a, b) => {
      let aName = a.generateName(nameFormat);
      let bName = b.generateName(nameFormat);
      return collator.compare(aName, bName);
    });

    let xml = "";
    for (let card of cards) {
      if (card.isMailList) {
        continue;
      }

      xml += `<separator/>\n${card.translateTo("xml")}\n<separator/>\n`;
    }

    this._printURL(
      URL.createObjectURL(
        new File(
          [
            `<?xml version="1.0"?>`,
            `<?xml-stylesheet type="text/css" href="chrome://messagebody/skin/abPrint.css"?>`,
            `<directory>`,
            `<title xmlns="http://www.w3.org/1999/xhtml">${title}</title>`,
            xml,
            `</directory>`,
          ],
          "text/xml"
        )
      )
    );
  },

  async _printURL(url) {
    let topWindow = window.browsingContext.topChromeWindow;
    await topWindow.PrintUtils.loadPrintBrowser(url);
    topWindow.PrintUtils.startPrintWindow(
      topWindow.PrintUtils.printBrowser.browsingContext,
      {}
    );
  },
};

/**
 * A span that displays the current time in a given time zone.
 * The time is updated every minute.
 */
class ActiveTime extends HTMLSpanElement {
  connectedCallback() {
    if (this.hasConnected) {
      return;
    }

    this.hasConnected = true;
    this.setAttribute("is", "active-time");

    try {
      this.formatter = new Services.intl.DateTimeFormat(
        Services.locale.appLocalesAsBCP47,
        {
          timeZone: this.getAttribute("tz"),
          weekday: "long",
          hour: "numeric",
          minute: "2-digit",
        }
      );
    } catch {
      // DateTimeFormat will throw if the time zone is unknown.
      // If it does this will just be an empty span.
      return;
    }
    this.update = this.update.bind(this);
    this.update();

    CalMetronome.on("minute", this.update);
    window.addEventListener("unload", this, { once: true });
  }

  disconnectedCallback() {
    CalMetronome.off("minute", this.update);
  }

  handleEvent() {
    CalMetronome.off("minute", this.update);
  }

  update() {
    this.textContent = this.formatter.format(new Date());
  }
}
customElements.define("active-time", ActiveTime, { extends: "span" });
