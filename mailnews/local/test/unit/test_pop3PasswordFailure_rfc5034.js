/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Tests password failure with RFC5034 auth.
 *
 * This test checks to see if the pop3 password failure is handled correctly
 * in the case of the server dropping the connection during auth login.
 * We use POP3_RFC5034_handler so auth=login will be supported.
 * The steps are:
 *   - Have an invalid password in the password database.
 *   - Check we get a prompt asking what to do.
 *   - Check retry does what it should do.
 *   - Check cancel does what it should do.
 *   - Re-initiate connection, this time select enter new password, check that
 *     we get a new password prompt and can enter the password.
 */

/* import-globals-from ../../../test/resources/alertTestUtils.js */
/* import-globals-from ../../../test/resources/passwordStorage.js */
load("../../../resources/alertTestUtils.js");
load("../../../resources/passwordStorage.js");

var { PromiseTestUtils } = ChromeUtils.importESModule(
  "resource://testing-common/mailnews/PromiseTestUtils.sys.mjs"
);

var server;
var daemon;
var incomingServer;
var attempt = 0;

var kUserName = "testpop3";
var kInvalidPassword = "pop3test";
var kValidPassword = "testpop3";

add_setup(async function () {
  // Enable debug for the sign on.
  Services.prefs.setBoolPref("signon.debug", true);

  // Prepare files for passwords (generated by a script in bug 1018624).
  await setupForPassword("signons-mailnews1.8.json");

  registerAlertTestUtils();

  // Set up the Server
  daemon = new Pop3Daemon();
  function createHandler(d) {
    var handler = new POP3_RFC5034_handler(d);
    handler.dropOnAuthFailure = true;
    // Login information needs to match the one stored in the signons json file.
    handler.kUsername = kUserName;
    handler.kPassword = kValidPassword;
    return handler;
  }
  server = new nsMailServer(createHandler, daemon);
  server.start();

  // Set up the basic accounts and folders.
  // We would use createPop3ServerAndLocalFolders() however we want to have
  // a different username and NO password for this test (as we expect to load
  // it from the signons json file in which the login information is stored).
  localAccountUtils.loadLocalMailAccount();

  incomingServer = MailServices.accounts.createIncomingServer(
    kUserName,
    "localhost",
    "pop3"
  );

  incomingServer.port = server.port;

  // Check that we haven't got any messages in the folder, if we have its a test
  // setup issue.
  Assert.equal(localAccountUtils.inboxFolder.getTotalMessages(false), 0);

  daemon.setMessages(["message1.eml"]);
});

add_task(async function getMail1() {
  // Now get the mail.
  const urlListener = new PromiseTestUtils.PromiseUrlListener();
  MailServices.pop3.GetNewMail(
    gDummyMsgWindow,
    urlListener,
    localAccountUtils.inboxFolder,
    incomingServer
  );
  server.performTest();
  await Assert.rejects(
    urlListener.promise,
    reason => {
      return reason === Cr.NS_ERROR_FAILURE;
    },
    "Check that wrong password is entered and thrown"
  );
  // We shouldn't have emails as the auth failed.
  Assert.equal(localAccountUtils.inboxFolder.getTotalMessages(false), 0);
  // Sanity check that we are at attempt 2.
  Assert.equal(attempt, 2);

  // Check that we haven't forgotten the login even though we've retried and cancelled.
  const logins = Services.logins.findLogins(
    "mailbox://localhost",
    null,
    "mailbox://localhost"
  );

  Assert.equal(logins.length, 1);
  Assert.equal(logins[0].username, kUserName);
  Assert.equal(logins[0].password, kInvalidPassword);

  server.resetTest();
});

add_task(async function getMail2() {
  // Now get the mail.
  const urlListener = new PromiseTestUtils.PromiseUrlListener();
  MailServices.pop3.GetNewMail(
    gDummyMsgWindow,
    urlListener,
    localAccountUtils.inboxFolder,
    incomingServer
  );
  server.performTest();
  await urlListener.promise;
  Assert.equal(attempt, 4);
  // On the last attempt (4th), we should have successfully got one mail.
  Assert.equal(localAccountUtils.inboxFolder.getTotalMessages(false), 1);

  // Now check the new one has been saved.
  const logins = Services.logins.findLogins(
    "mailbox://localhost",
    null,
    "mailbox://localhost"
  );

  Assert.equal(logins.length, 1);
  Assert.equal(logins[0].username, kUserName);
  Assert.equal(logins[0].password, kValidPassword);
});

add_task(function endTest() {
  // Cleanup for potential Sockets/Ports leakage.
  server.stop();
  server = null;
  daemon = null;
  incomingServer = null;
  var thread = Services.tm.currentThread;
  while (thread.hasPendingEvents()) {
    thread.processNextEvent(true);
  }
});

/* exported alert, confirmEx, promptPasswordPS */
function alertPS(parent, aDialogText, aText) {
  // The first few attempts may prompt about the password problem, the last
  // attempt shouldn't.
  Assert.ok(attempt < 4);

  // Log the fact we've got an alert, but we don't need to test anything here.
  info("Alert Title: " + aDialogText + "\nAlert Text: " + aText);
}

function confirmExPS(
  parent,
  aDialogTitle,
  aText,
  aButtonFlags,
  aButton0Title,
  aButton1Title,
  aButton2Title,
  aCheckMsg,
  aCheckState
) {
  switch (++attempt) {
    // First attempt, retry.
    case 1:
      info("Attempting retry");
      return 0;
    // Second attempt, cancel.
    case 2:
      info("Cancelling login attempt");
      return 1;
    // Third attempt, retry.
    case 3:
      info("Attempting Retry");
      return 0;
    // Fourth attempt, enter a new password.
    case 4:
      info("Enter new password");
      return 2;
    default:
      throw new Error("unexpected attempt number " + attempt);
  }
}

/**
 * Extension for alertTestUtils.
 * Make sure that at the 4th attempt the correct password is used.
 */
function promptPasswordPS(
  aParent,
  aDialogTitle,
  aText,
  aPassword,
  aCheckMsg,
  aCheckState
) {
  if (attempt == 4) {
    aPassword.value = kValidPassword;
    aCheckState.value = true;
    return true;
  }
  return false;
}
