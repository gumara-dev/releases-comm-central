/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Testing of search by junk percent and junk score origin

/* import-globals-from ../../../test/resources/searchTestUtils.js */
load("../../../resources/searchTestUtils.js");

var { MailServices } = ChromeUtils.importESModule(
  "resource:///modules/MailServices.sys.mjs"
);

var IsGreaterThan = Ci.nsMsgSearchOp.IsGreaterThan;
var IsLessThan = Ci.nsMsgSearchOp.IsLessThan;
var Is = Ci.nsMsgSearchOp.Is;
var Isnt = Ci.nsMsgSearchOp.Isnt;
var IsEmpty = Ci.nsMsgSearchOp.IsEmpty;
var IsntEmpty = Ci.nsMsgSearchOp.IsntEmpty;

var offlineMail = Ci.nsMsgSearchScope.offlineMail;

var JunkScoreOrigin = Ci.nsMsgSearchAttrib.JunkScoreOrigin;
var JunkPercent = Ci.nsMsgSearchAttrib.JunkPercent;
var JunkStatus = Ci.nsMsgSearchAttrib.JunkStatus;

var fileName = "../../../data/bugmail1";

/*
 * The search for junkpercent is defined as the effective value,
 * while the "junkpercent" database term is always the result
 * from the bayes filter. This is optimized to make views that
 * rely on junk percent search work with the best value for junk
 * percent, while allowing junk percent from the bayes filter
 * to be saved for analysis.
 *
 * This means that the search for "junk percent" only uses the
 * database junkpercent value if junkscoreorigin is "plugin".
 * Otherwise, it uses junkstatus (if set) or defaults to 0
 * (not junk) if the message is unclassified.
 */

var Tests = [
  {
    // test empty junk status
    junkScore: false,
    testValue: 90,
    attrib: JunkStatus,
    op: IsEmpty,
    count: 1,
  },
  {
    junkScore: false,
    testValue: 90,
    attrib: JunkStatus,
    op: IsntEmpty,
    count: 0,
  },
  {
    junkScore: "0",
    junkScoreOrigin: "plugin",
    junkPercent: "10",
    testValue: 90,
    attrib: JunkStatus,
    op: IsntEmpty,
    count: 1,
  },
  {
    junkScore: "0",
    junkScoreOrigin: "plugin",
    junkPercent: "10",
    testValue: 90,
    attrib: JunkStatus,
    op: IsEmpty,
    count: 0,
  },
  {
    junkScore: "100",
    junkScoreOrigin: "plugin",
    junkPercent: "10",
    testValue: 90,
    attrib: JunkStatus,
    op: IsntEmpty,
    count: 1,
  },
  {
    junkScore: "100",
    junkScoreOrigin: "plugin",
    junkPercent: "10",
    testValue: 90,
    attrib: JunkStatus,
    op: IsEmpty,
    count: 0,
  },
  {
    // Use junkpercent from database
    junkScore: "0",
    junkScoreOrigin: "plugin",
    junkPercent: "10",
    testValue: 90,
    attrib: JunkPercent,
    op: IsGreaterThan,
    count: 0,
  },
  {
    junkScore: "0",
    junkScoreOrigin: "plugin",
    junkPercent: "10",
    testValue: 90,
    attrib: JunkPercent,
    op: IsLessThan,
    count: 1,
  },
  {
    junkScore: "0",
    junkScoreOrigin: "plugin",
    junkPercent: "10",
    testValue: 90,
    attrib: JunkPercent,
    op: Is,
    count: 0,
  },
  {
    junkScore: "0",
    junkScoreOrigin: "plugin",
    junkPercent: "90",
    testValue: 10,
    attrib: JunkPercent,
    op: IsGreaterThan,
    count: 1,
  },
  {
    junkScore: "0",
    junkScoreOrigin: "plugin",
    junkPercent: "90",
    testValue: 10,
    attrib: JunkPercent,
    op: IsLessThan,
    count: 0,
  },
  {
    junkScore: "0",
    junkScoreOrigin: "plugin",
    junkPercent: "10",
    testValue: 10,
    attrib: JunkPercent,
    op: Is,
    count: 1,
  },
  {
    // values set by user, use junkscore not junkpercent
    junkScore: "0",
    junkScoreOrigin: "user",
    junkPercent: "90",
    testValue: 50,
    attrib: JunkPercent,
    op: IsGreaterThan,
    count: 0,
  },
  {
    junkScore: "0",
    junkScoreOrigin: "user",
    junkPercent: "90",
    testValue: 50,
    attrib: JunkPercent,
    op: IsLessThan,
    count: 1,
  },
  {
    junkScore: "0",
    junkScoreOrigin: "user",
    junkPercent: "90",
    testValue: 50,
    attrib: JunkPercent,
    op: Is,
    count: 0,
  },
  {
    junkScore: "100",
    junkScoreOrigin: "user",
    junkPercent: "10",
    testValue: 50,
    attrib: JunkPercent,
    op: IsGreaterThan,
    count: 1,
  },
  {
    junkScore: "100",
    junkScoreOrigin: "user",
    junkPercent: "10",
    testValue: 50,
    attrib: JunkPercent,
    op: IsLessThan,
    count: 0,
  },
  {
    junkScore: "0",
    junkScoreOrigin: "user",
    junkPercent: "90",
    testValue: 0,
    attrib: JunkPercent,
    op: Is,
    count: 1,
  },
  {
    // default to 0 when nothing set
    junkScore: "",
    junkScoreOrigin: "",
    junkPercent: "",
    testValue: 0,
    attrib: JunkPercent,
    op: Is,
    count: 1,
  },
  {
    // junkscoreorigin search tests
    junkScore: "0",
    junkScoreOrigin: "plugin",
    junkPercent: "50",
    testValue: "plugin",
    attrib: JunkScoreOrigin,
    op: Is,
    count: 1,
  },
  {
    junkScore: "0",
    junkScoreOrigin: "plugin",
    junkPercent: "50",
    testValue: "plugin",
    attrib: JunkScoreOrigin,
    op: Isnt,
    count: 0,
  },
  {
    junkScore: "0",
    junkScoreOrigin: "filter",
    junkPercent: "50",
    testValue: "plugin",
    attrib: JunkScoreOrigin,
    op: Is,
    count: 0,
  },
  {
    junkScore: "0",
    junkScoreOrigin: "filter",
    junkPercent: "50",
    testValue: "plugin",
    attrib: JunkScoreOrigin,
    op: Isnt,
    count: 1,
  },
];

function run_test() {
  localAccountUtils.loadLocalMailAccount();

  // test that validity table terms are valid

  // offline mail table
  testValidityTable(offlineMail, Is, JunkPercent, true);
  testValidityTable(offlineMail, Isnt, JunkPercent, false);
  testValidityTable(offlineMail, IsGreaterThan, JunkPercent, true);
  testValidityTable(offlineMail, IsLessThan, JunkPercent, true);

  testValidityTable(offlineMail, Is, JunkScoreOrigin, true);
  testValidityTable(offlineMail, Isnt, JunkScoreOrigin, true);
  testValidityTable(offlineMail, IsGreaterThan, JunkScoreOrigin, false);
  testValidityTable(offlineMail, IsLessThan, JunkScoreOrigin, false);

  // Get a message into the local filestore. function testJunkSearch() continues the testing after the copy.
  do_test_pending();
  var file = do_get_file(fileName);
  MailServices.copy.copyFileMessage(
    file,
    localAccountUtils.inboxFolder,
    null,
    false,
    0,
    "",
    copyListener,
    null
  );
  return true;
}

var hdr;
/** @implements {nsIMsgCopyServiceListener} */
var copyListener = {
  onStartCopy() {},
  onProgress() {},
  setMessageKey(aKey) {
    hdr = localAccountUtils.inboxFolder.GetMessageHeader(aKey);
  },
  getMessageId() {
    return null;
  },
  onStopCopy() {
    testJunkSearch();
  },
};

// Runs at completion of each copy
// process each test from queue, calls itself upon completion of each search
function testJunkSearch() {
  var test = Tests.shift();
  if (test) {
    if (test.junkScore) {
      hdr.setStringProperty("junkpercent", test.junkPercent);
      hdr.setStringProperty("junkscoreorigin", test.junkScoreOrigin);
      hdr.setStringProperty("junkscore", test.junkScore);
    }

    new TestSearch(
      localAccountUtils.inboxFolder,
      test.testValue,
      test.attrib,
      test.op,
      test.count,
      testJunkSearch
    );
  } else {
    hdr = null;
    do_test_finished();
  }
}
