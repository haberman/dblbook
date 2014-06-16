
function parseXml(str) {
  parser = new DOMParser();
  return parser.parseFromString(str, "text/xml");
}

function getXmlText(node, ns, name) {
  var found = node.getElementsByTagNameNS(ns, name)[0];
  return found ? found.innerHTML : undefined;
}

function getXmlText2(node, ns, name, ns2, name2) {
  var found = node.getElementsByTagNameNS(ns, name)[0];
  if (!found) {
    return undefined;
  }
  found = found.getElementsByTagNameNS(ns2, name2)[0];
  return found ? found.innerHTML : undefined;
}

function mapType(type) {
  if (type == "BANK") {
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

function importGnucash2(xmlString, db, rootForNew) {
  // Namespaces.
  var gnc = "http://www.gnucash.org/XML/gnc";
  var act = "http://www.gnucash.org/XML/act";
  var trn = "http://www.gnucash.org/XML/trn";
  var ts = "http://www.gnucash.org/XML/ts";
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
      // Skip for now.
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
    var newAccount = {
      guid: getXmlText(gnucashTransaction, trn, "id"),
      timestamp: getXmlText2(gnucashTransaction, trn, "date-posted", ts, "date"),
      description: getXmlText(gnucashTransaction, trn, "description"),
    }

    newAccount.timestamp = Date.parse(newAccount.timestamp) * 1000;

    console.log(newAccount);

    db.createTransaction(gnucashTransaction);
  }
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
