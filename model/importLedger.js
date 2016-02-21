
/* @flow */

import { DB, Account } from './model.js';

class LedgerImporter {
  db: DB;
  accounts: Map<string, Account>;

  constructor(db: DB) {
    this.db = db;
    this.accounts = new Map()
  }

  getAccount(name: string) {
    // name is something like:
    //   Assets:Cash Accounts:ING Checking
    let account = this.accounts.get(name);

    if (!account) {
      let lastColon = name.lastIndexOf(":");
      let parentAccount;
      let leafName;

      if (lastColon != -1) {
        parentAccount = this.getAccount(name.substring(0, lastColon));
        leafName = name.substring(lastColon + 1)
      } else {
        leafName = name;
      }

      let accountData = {
        name: leafName,
        parent_guid: undefined,
        type: "ASSET",
      };

      if (parentAccount) {
        accountData.parent_guid = parentAccount.data.guid;
        accountData.type = parentAccount.data.type;
      } else {
        // Ledger doesn't give accounts a type (ie. ASSET, LIABILITY) so the
        // best we can do is hope the user has a scheme like top-level accounts
        // being named "Assets", "Liabilities", etc.
        if (leafName == "Assets") {
          accountData.type = "ASSET";
        } else if (leafName == "Liabilities") {
          accountData.type = "LIABILITY"
        } else if (leafName == "Income") {
          accountData.type = "INCOME"
        } else if (leafName == "Expenses") {
          accountData.type = "EXPENSE"
        } else {
          console.log("Warning: guessing account type ASSET for " + name);
          accountData.type = "ASSET";
        }
      }

      account = this.db.createAccount(accountData);
      this.accounts.set(name, account);
    }

    return account;
  }

  import(ledgerData: string) {
    // This parsing is very rough/inexact -- to make more robust, we should
    // see exactly how ledger parses these things.

    let accountAmountDivider = new RegExp(/ \$?-?\d+/);

    this.db.atomic(() => {
      let txnData = null;
      let skip = false;

      for (let line of ledgerData.split(/\n/)) {

        if (txnData) {
          // We're already in the middle of a transaction.

          if (line.trim() == "") {
            // Blank line, transaction is over.  Write completed transaction.

            if (skip) {
              console.log("Warning, skipping txn: ", txnData);
            } else {
              this.db.createTransaction(txnData);
            }

            txnData = null;
            skip = false;
          } else {
            // Parse a line like:
            //     Assets:Cash Accounts:ING Checking                 $-322.00

            let match = accountAmountDivider.exec(line);
            if (!match) {
              throw "Couldn't parse line: " + line;
            }

            let accountNames = line.substring(0, match.index).trim();
            let amount = line.substring(match.index).trim();
            let account = this.getAccount(accountNames);

            if (amount.indexOf(".") == -1) {
              amount = amount + ".00";
            }

            if (amount.indexOf("$") == 0) {
              // Amount like $-4,138.46
              txnData.entry.push({
                account_guid: account.data.guid,
                amount: {"USD": amount.substring(1).replace(/,/g, '')}
              });
            } else {
              // Amount like 12.757 VWINX @ $16.22
              skip = true;
            }
          }
        } else {
          // New transaction.
          // Parse a line like:
          // 2009/11/27 Mortgage Payment
          let space = line.indexOf(" ");
          let date = line.substring(0, space).trim();
          let description = line.substring(space).trim();
          txnData = {
            description: description,
            date: date,
            entry: []
          }
        }

      }
    });
  }
}

export function importLedger(ledgerData: string, db: DB) {
  new LedgerImporter(db).import(ledgerData);
}
