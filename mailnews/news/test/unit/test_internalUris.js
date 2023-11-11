/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/* Tests internal URIs generated by various methods in the code base.
 * If you manually generate a news URI somewhere, please add it to this test.
 */

/* import-globals-from ../../../test/resources/alertTestUtils.js */
load("../../../resources/alertTestUtils.js");

var { MailServices } = ChromeUtils.import(
  "resource:///modules/MailServices.jsm"
);
var { PromiseTestUtils } = ChromeUtils.import(
  "resource://testing-common/mailnews/PromiseTestUtils.jsm"
);
var { PromiseUtils } = ChromeUtils.importESModule(
  "resource://gre/modules/PromiseUtils.sys.mjs"
);

var daemon, localserver, server;

var kCancelArticle =
  "From: fake@acme.invalid\n" +
  "Newsgroups: test.filter\n" +
  "Subject: cancel <4@regular.invalid>\n" +
  "References: <4@regular.invalid>\n" +
  "Control: cancel <4@regular.invalid>\n" +
  "MIME-Version: 1.0\n" +
  "Content-Type: text/plain\n" +
  "\n" +
  "This message was cancelled from within ";

var dummyMsgWindow;

add_setup(function setupTest() {
  registerAlertTestUtils();

  daemon = setupNNTPDaemon();
  server = makeServer(NNTP_RFC2980_handler, daemon);
  server.start();
  localserver = setupLocalServer(server.port);

  // Set up an identity for posting.
  const identity = MailServices.accounts.createIdentity();
  identity.fullName = "Normal Person";
  identity.email = "fake@acme.invalid";
  MailServices.accounts.FindAccountForServer(localserver).addIdentity(identity);

  dummyMsgWindow = new DummyMsgWindow();
});

add_task(async function test_newMsgs() {
  // This tests nsMsgNewsFolder::GetNewsMessages via getNewMessages.
  const folder = localserver.rootFolder.getChildNamed("test.filter");
  Assert.equal(folder.getTotalMessages(false), 0);
  const urlListener = new PromiseTestUtils.PromiseUrlListener();
  folder.getNewMessages(null, urlListener);
  await urlListener.promise;
  Assert.equal(folder.getTotalMessages(false), 8);
});

add_task(async function test_cancel() {
  // This tests nsMsgNewsFolder::CancelMessage.
  const folder = localserver.rootFolder.getChildNamed("test.filter");
  const db = folder.msgDatabase;
  const hdr = db.getMsgHdrForKey(4);

  folder.QueryInterface(Ci.nsIMsgNewsFolder).cancelMessage(hdr, dummyMsgWindow);
  await dummyMsgWindow.promise;

  // Reset promise state.
  dummyMsgWindow.deferPromise();

  Assert.equal(folder.getTotalMessages(false), 7);

  // Check the content of the CancelMessage itself.
  const article = daemon.getGroup("test.filter")[9];
  // Since the cancel message includes the brand name (Daily, Thunderbird), we
  // only check the beginning of the string.
  Assert.ok(article.fullText.startsWith(kCancelArticle));
});

function generateLongArticle() {
  // After converting to base64, the message body will be 65536 * 4 = 256KB.
  const arr = new Uint8Array(65536);
  crypto.getRandomValues(arr);
  return `Date: Mon, 23 Jun 2008 19:58:07 +0400
From: Normal Person <fake@acme.invalid>
MIME-Version: 1.0
Subject: Odd Subject
Content-Type: text/plain; charset=ISO-8859-1; format=flowed
Content-Transfer-Encoding: 7bit
Message-ID: <2@regular.invalid>

${btoa(arr)}
${btoa(arr)}
${btoa(arr)}
`;
}

add_task(async function test_fetchMessage() {
  // Replace the second article with a large message.
  daemon.addArticleToGroup(
    new NewsArticle(generateLongArticle()),
    "test.filter",
    2
  );

  // Tests nsNntpService::CreateMessageIDURL via FetchMessage.
  const streamListener = new PromiseTestUtils.PromiseStreamListener();
  const urlListener = new PromiseTestUtils.PromiseUrlListener();
  const folder = localserver.rootFolder.getChildNamed("test.filter");
  MailServices.nntp.fetchMessage(folder, 2, null, streamListener, urlListener);
  await urlListener.promise;
  const data = await streamListener.promise;
  // To point out that the streamListener Promise shouldn't reject.
  Assert.ok(data);
});

add_task(async function test_fetchMessageNoStreamListener() {
  // Tests nsNntpService::CreateMessageIDURL via FetchMessage.
  const streamListener = null;
  const urlListener = new PromiseTestUtils.PromiseUrlListener();
  const folder = localserver.rootFolder.getChildNamed("test.filter");
  MailServices.nntp.fetchMessage(folder, 2, null, streamListener, urlListener);
  await urlListener.promise;
});

add_task(async function test_search() {
  // This tests nsNntpService::Search.
  const folder = localserver.rootFolder.getChildNamed("test.filter");
  var searchSession = Cc[
    "@mozilla.org/messenger/searchSession;1"
  ].createInstance(Ci.nsIMsgSearchSession);
  searchSession.addScopeTerm(Ci.nsMsgSearchScope.news, folder);

  const searchTerm = searchSession.createTerm();
  searchTerm.attrib = Ci.nsMsgSearchAttrib.Subject;
  const value = searchTerm.value;
  value.str = "First";
  searchTerm.value = value;
  searchTerm.op = Ci.nsMsgSearchOp.Contains;
  searchTerm.booleanAnd = false;
  searchSession.appendTerm(searchTerm);

  let hitCount;
  const searchListener = new PromiseTestUtils.PromiseSearchNotify(
    searchSession,
    {
      onSearchHit() {
        hitCount++;
      },
      onNewSearch() {
        hitCount = 0;
      },
    }
  );

  searchSession.search(null);
  await searchListener.promise;

  Assert.equal(hitCount, 1);
});

add_task(async function test_grouplist() {
  // This tests nsNntpService::GetListOfGroupsOnServer.
  const subserver = localserver.QueryInterface(Ci.nsISubscribableServer);
  const subscribablePromise = PromiseUtils.defer();
  const subscribeListener = {
    OnDonePopulating() {
      subscribablePromise.resolve();
    },
  };
  subserver.subscribeListener = subscribeListener;

  function enumGroups(rootUri) {
    const hierarchy = subserver.getChildURIs(rootUri);
    let groups = [];
    for (const name of hierarchy) {
      if (subserver.isSubscribable(name)) {
        groups.push(name);
      }
      if (subserver.hasChildren(name)) {
        groups = groups.concat(enumGroups(name));
      }
    }
    return groups;
  }

  MailServices.nntp.getListOfGroupsOnServer(localserver, null, false);
  await subscribablePromise.promise;

  const groups = enumGroups("");
  Assert.equal(groups.length, Object.keys(daemon._groups).length);
  for (const group in daemon._groups) {
    Assert.ok(groups.includes(group));
  }

  // First node in the group list, even though it is not subscribable,
  // parent of "test.empty" group.
  Assert.equal(subserver.getFirstChildURI(""), "test");

  // Release reference, somehow impedes GC of 'subserver'.
  subserver.subscribeListener = null;
});

add_task(async function test_postMessage() {
  // This tests nsNntpService::SetUpNntpUrlForPosting via PostMessage.
  const urlListener = new PromiseTestUtils.PromiseUrlListener();
  MailServices.nntp.postMessage(
    do_get_file("postings/post2.eml"),
    "misc.test",
    localserver.key,
    urlListener,
    null
  );
  await urlListener.promise;
  Assert.equal(daemon.getGroup("misc.test").keys.length, 1);
});

// Not tested because it requires UI, and this is insufficient, I think.
// function test_forwardInline() {
//   // This tests mime_parse_stream_complete via forwarding inline
//   let folder = localserver.rootFolder.getChildNamed("test.filter");
//   let hdr = folder.msgDatabase.getMsgHdrForKey(1);
//   MailServices.compose.forwardMessage("a@b.invalid", hdr, null,
//     localserver, Ci.nsIMsgComposeService.kForwardInline);
// }

add_task(async function test_escapedName() {
  // This does a few tests to make sure our internal URIs work for newsgroups
  // with names that need escaping.
  const evilName = "test.malformed&name";
  daemon.addGroup(evilName);
  daemon.addArticle(make_article(do_get_file("postings/bug670935.eml")));
  localserver.subscribeToNewsgroup(evilName);

  // Can we access it?
  const folder = localserver.rootFolder.getChildNamed(evilName);
  const newMessageUrlListener = new PromiseTestUtils.PromiseUrlListener();
  folder.getNewMessages(null, newMessageUrlListener);
  await newMessageUrlListener.promise;

  // If we get here, we didn't crash--newsgroups unescape properly.
  // Load a message, to test news-message: URI unescaping.
  const streamlistener = new PromiseTestUtils.PromiseStreamListener();
  const fetchMessageUrlListener = new PromiseTestUtils.PromiseUrlListener();
  MailServices.nntp.fetchMessage(
    folder,
    1,
    null,
    streamlistener,
    fetchMessageUrlListener
  );
  await fetchMessageUrlListener.promise;
  const data = await streamlistener.promise;
  // To point out that the streamListener Promise shouldn't reject.
  Assert.ok(data);
});

add_task(function cleanUp() {
  localserver.closeCachedConnections();
});

class DummyMsgWindow {
  QueryInterface = ChromeUtils.generateQI([
    "nsIMsgWindow",
    "nsISupportsWeakReference",
  ]);

  constructor() {
    this._deferredPromise = PromiseUtils.defer();
  }

  get statusFeedback() {
    const scopedThis = this;
    return {
      startMeteors() {},
      stopMeteors() {
        scopedThis._deferredPromise.resolve(true);
      },
      showProgress() {},
    };
  }

  get promptDialog() {
    return alertUtilsPrompts;
  }

  deferPromise() {
    this._deferredPromise = PromiseUtils.defer();
  }

  get promise() {
    return this._deferredPromise.promise;
  }
}

/* exported alert, confirmEx */
// Prompts for cancel.
function alertPS(parent, title, text) {}
function confirmExPS(parent, title, text, flags) {
  return 0;
}
