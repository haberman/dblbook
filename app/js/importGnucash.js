
function parseXml(str) {
  parser = new DOMParser();
  return parser.parseFromString(str, "text/xml");
}

function getXmlText(node, ns, name) {
  var found = node.getElementsByTagNameNS(ns, name)[0];
  return found ? found.textContent : undefined;
}

function getXmlText2(node, ns, name, ns2, name2) {
  var found = node.getElementsByTagNameNS(ns, name)[0];
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
  var cmdty="http://www.gnucash.org/XML/cmdty";
  var space = getXmlText(commodity, cmdty, "space");
  var id = getXmlText(commodity, cmdty, "id");
  if (space == "ISO4217") {
    return id;
  } else {
    return space + ":" + id;
  }
}

// "83523/100" -> "835.23"
function ratioToDecimal(ratioStr) {
  var parts = ratioStr.split("/");
  var amount = parts[0];
  var precision = Math.log10(parseInt(parts[1]));
  var isNegative = false;
  assert(Math.round(precision) == precision);

  if (amount.substring(0, 1) == "-") {
    isNegative = true;
    amount = amount.substr(1);
  }

  while (amount.length <= precision) {
    amount = "0" + amount;
  }
  var ofs = amount.length - precision;
  var ret = amount.substr(0, ofs) + "." + amount.substr(ofs);
  if (isNegative) {
    ret = "-" + ret;
  }
  return ret;
}

function importGnucash2(xmlString, db, rootForNew) {
  // Namespaces.
  var gnc = "http://www.gnucash.org/XML/gnc";
  var act = "http://www.gnucash.org/XML/act";
  var trn = "http://www.gnucash.org/XML/trn";
  var ts = "http://www.gnucash.org/XML/ts";
  var split = "http://www.gnucash.org/XML/split";
  var xml = parseXml(xmlString);

  var gnucashRootGuid;

  // Import accounts.
  var accounts = xml.getElementsByTagNameNS(gnc, "account");
  for (var i = 0; i < accounts.length; i++) {
    var gnucashAccount = accounts[i];
    var newAccount = {
      guid: getXmlText(gnucashAccount, act, "id"),
      name: getXmlText(gnucashAccount, act, "name"),
      type: mapType(getXmlText(gnucashAccount, act, "type")),
      commodity_guid: mapCommodity(gnucashAccount, act, "commodity"),
    }

    // We count on seeing the parent first.
    if (newAccount.type == "ROOT") {
      delete newAccount.type;
      gnucashRootGuid = newAccount.guid;
    } else if (newAccount.type == "EQUITY") {
      console.log("Skipping: ", newAccount)
    } else {
      var parentGuid = getXmlText(gnucashAccount, act, "parent");
      if (parentGuid == gnucashRootGuid) {
        newAccount.parent_guid = rootForNew;
      } else {
        newAccount.parent_guid = parentGuid;
      }

      db.createAccount(newAccount);
    }
  }

  // Import transactions.
  var transactions = xml.getElementsByTagNameNS(gnc, "transaction");
  for (var i = 0; i < transactions.length; i++) {
    var gnucashTransaction = transactions[i];
    var newTransaction = {
      guid: getXmlText(gnucashTransaction, trn, "id"),
      timestamp: getXmlText2(gnucashTransaction, trn, "date-posted", ts, "date"),
      description: getXmlText(gnucashTransaction, trn, "description"),
      entry: [],
    }

    var timestampMs = Date.parse(newTransaction.timestamp);
    newTransaction.timestamp = timestampMs * 1000;

    var splits = gnucashTransaction.getElementsByTagNameNS(trn, "split")
    for (var j = 0; j < splits.length; j++) {
      var gnucashSplit = splits[j];
      var newSplit = {
        account_guid: getXmlText(gnucashSplit, split, "account"),
        amount: ratioToDecimal(getXmlText(gnucashSplit, split, "quantity")),
      }
      newTransaction.entry.push(newSplit);
    }

    db.createTransaction(newTransaction);
  }

  console.log("Imported " + accounts.length + " accounts, " +
              transactions.length + " transactions");
}

function importGnucash(event) {
  var reader = new FileReader();
  reader.onload = (function(e) {
    importGnucash2(reader.result, document.db);
  });
  reader.onerror = (function(e) {
  });
  reader.readAsText(event.target.files[0]);
}
