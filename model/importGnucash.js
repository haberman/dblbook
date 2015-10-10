
/* @flow */

import { DB, Account } from './model.js';

function parseXml(str) {
  let parser = new DOMParser();
  console.log(parser);
  return parser.parseFromString(str, "text/xml");
}

function getXmlText(node, ns, name) {
  let found = node.getElementsByTagNameNS(ns, name)[0];
  return found ? found.textContent : undefined;
}

function getXmlText2(node, ns, name, ns2, name2) {
  let found = node.getElementsByTagNameNS(ns, name)[0];
  if (!found) {
    return undefined;
  }
  found = found.getElementsByTagNameNS(ns2, name2)[0];
  return found ? found.textContent : undefined;
}

function mapType(type) {
  if (type == "BANK" || type == "CASH" || type == "MUTUAL") {
    return "ASSET";
  } else if (type == "EQUITY") {
    // XXX: Treat as asset for now.
    return "ASSET";
  } else {
    return type;
  }
}

function mapCommodity(commodity) {
  let cmdty="http://www.gnucash.org/XML/cmdty";
  let space = getXmlText(commodity, cmdty, "space");
  let id = getXmlText(commodity, cmdty, "id");
  if (space == "ISO4217") {
    return id;
  } else if (space) {
    return space + ":" + id;
  } else {
    throw "Error: no commodity space";
  }
}

// "83523/100" -> "835.23"
function ratioToDecimal(ratioStr: string) {
  let parts = ratioStr.split("/");
  let amount = parts[0];
  let precision = Math.log10(parseInt(parts[1]));
  let isNegative = false;
  if (Math.round(precision) != precision) {
    throw "Precision didn't match.";
  }

  if (amount.substring(0, 1) == "-") {
    isNegative = true;
    amount = amount.substr(1);
  }

  while (amount.length <= precision) {
    amount = "0" + amount;
  }
  let ofs = amount.length - precision;
  let ret = amount.substr(0, ofs) + "." + amount.substr(ofs);
  if (isNegative) {
    ret = "-" + ret;
  }
  return ret;
}

export function importGnucash(xmlString: string, db: DB, rootForNew: ?Account) {
  // Namespaces.
  let gnc = "http://www.gnucash.org/XML/gnc";
  let act = "http://www.gnucash.org/XML/act";
  let trn = "http://www.gnucash.org/XML/trn";
  let ts = "http://www.gnucash.org/XML/ts";
  let split = "http://www.gnucash.org/XML/split";
  let xml = parseXml(xmlString);

  let gnucashRootGuid;
  let accountCommodities = new Map();

  let accounts = xml.getElementsByTagNameNS(gnc, "account");
  let transactions = xml.getElementsByTagNameNS(gnc, "transaction");

  // Import accounts.
  db.atomic(() => {
    for (let i = 0; i < accounts.length; i++) {
      let gnucashAccount = accounts[i];
      let newAccount = {
        guid: getXmlText(gnucashAccount, act, "id"),
        name: getXmlText(gnucashAccount, act, "name"),
        type: mapType(getXmlText(gnucashAccount, act, "type")),
        parent_guid: null,
      }
      let commodity = mapCommodity(gnucashAccount, act, "commodity");
      accountCommodities.set(newAccount.guid, commodity);

      // We count on seeing the parent first.
      if (newAccount.type == "ROOT") {
        delete newAccount.type;
        gnucashRootGuid = newAccount.guid;
      } else if (newAccount.type == "EQUITY") {
        console.log("Skipping: ", newAccount)
      } else {
        let parentGuid = getXmlText(gnucashAccount, act, "parent");
        if (parentGuid == gnucashRootGuid) {
          newAccount.parent_guid = rootForNew;
        } else {
          newAccount.parent_guid = parentGuid;
        }

        db.createAccount(newAccount);
      }
    }
  });

  // Import transactions.
  db.atomic(() => {
    for (let i = 0; i < transactions.length; i++) {
      let gnucashTransaction = transactions[i];
      let newTransaction = {
        guid: getXmlText(gnucashTransaction, trn, "id"),
        date: getXmlText2(gnucashTransaction, trn, "date-posted", ts, "date"),
        description: getXmlText(gnucashTransaction, trn, "description"),
        entry: [],
      }

      let splits = gnucashTransaction.getElementsByTagNameNS(trn, "split")
      for (let j = 0; j < splits.length; j++) {
        let gnucashSplit = splits[j];
        let accountGuid = getXmlText(gnucashSplit, split, "account");
        let quantityText = getXmlText(gnucashSplit, split, "quantity");
        if (!accountGuid || !quantityText) {
          throw "Error: missing account or quantity.";
        }
        let quantity = ratioToDecimal(quantityText);
        let newSplit = {
          account_guid: accountGuid,
          amount: {},
        };
        newSplit.amount[accountCommodities.get(accountGuid)] = quantity;
        newTransaction.entry.push(newSplit);
      }

      db.createTransaction(newTransaction);
    }
  });

  console.log("Imported " + accounts.length + " accounts, " +
              transactions.length + " transactions");
}
