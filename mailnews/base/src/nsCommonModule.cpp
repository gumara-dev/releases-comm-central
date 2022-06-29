/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

#include "mozilla/ModuleUtils.h"
#include "mozilla/TransactionManager.h"
#include "nsBaseCommandController.h"
#include "nsMsgBaseCID.h"
#include "nsSyncStreamListener.h"
#include "nsUserInfo.h"
#include "nsXULAppAPI.h"

using mozilla::TransactionManager;

NS_GENERIC_FACTORY_CONSTRUCTOR(nsBaseCommandController)
NS_DEFINE_NAMED_CID(NS_BASECOMMANDCONTROLLER_CID);

NS_GENERIC_FACTORY_CONSTRUCTOR(TransactionManager)
NS_DEFINE_NAMED_CID(NS_TRANSACTIONMANAGER_CID);

NS_GENERIC_FACTORY_CONSTRUCTOR(nsUserInfo)
NS_DEFINE_NAMED_CID(NS_USERINFO_CID);

const mozilla::Module::CIDEntry kCommonCIDs[] = {
    {&kNS_BASECOMMANDCONTROLLER_CID, false, nullptr,
     nsBaseCommandControllerConstructor},
    {&kNS_TRANSACTIONMANAGER_CID, false, nullptr,
     TransactionManagerConstructor},
    {&kNS_USERINFO_CID, false, nullptr, nsUserInfoConstructor},
    {nullptr}};

const mozilla::Module::ContractIDEntry kCommonContracts[] = {
    {NS_BASECOMMANDCONTROLLER_CONTRACTID, &kNS_BASECOMMANDCONTROLLER_CID},
    {NS_TRANSACTIONMANAGER_CONTRACTID, &kNS_TRANSACTIONMANAGER_CID},
    {NS_USERINFO_CONTRACTID, &kNS_USERINFO_CID},
    {nullptr}};

static const mozilla::Module kCommonModule = {mozilla::Module::kVersion,
                                              kCommonCIDs,
                                              kCommonContracts,
                                              nullptr,
                                              nullptr,
                                              nullptr,
                                              nullptr};

extern const mozilla::Module kMailNewsModule;
extern const mozilla::Module kMailNewsImportModule;
#ifdef MOZ_MAPI_SUPPORT
extern const mozilla::Module kMAPIModule;
#endif
#ifdef MOZ_SUITE
extern const mozilla::Module kSuiteModule;
#endif

class ModulesInit {
 public:
  ModulesInit() {
    XRE_AddStaticComponent(&kCommonModule);
    XRE_AddStaticComponent(&kMailNewsModule);
    XRE_AddStaticComponent(&kMailNewsImportModule);
#ifdef MOZ_MAPI_SUPPORT
    XRE_AddStaticComponent(&kMAPIModule);
#endif
#ifdef MOZ_SUITE
    XRE_AddStaticComponent(&kSuiteModule);
#endif
  }
};

ModulesInit gInit;
