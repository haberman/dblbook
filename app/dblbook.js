
Array.prototype.last = Array.prototype.last || function() {
    var l = this.length;
    return this[l-1];
}

var config = JSON.parse(localStorage.getItem("config"));

// Load all accounts, calculate balances.
var accounts = config.accounts.map(function(account) {
  var json = localStorage.getItem(account.filename);
  var txns = json.split("\n").map(function(line) {
    return JSON.parse(line);
  });
  var txns_with_balance = dblbook.calculateBalances(txns, "USD");
  return {
    "config": account,
    "txns": txns,
    "txns_with_balance": txns_with_balance,
    "balance": txns_with_balance.last().balance
  };
});

function registerRow(txn) {
  return [txn.txn.date, txn.txn.description, txn.txn.amount, txn.balance];
}

function registerCellStyles(i) {
  return new Array("", "", "amount", "balance")[i];
}

d3.select("#register tbody").selectAll("tr")
  .data(accounts[0].txns_with_balance)
    .enter().append("tr").selectAll("td")
      .data(function(t) { return registerRow(t) })
        .enter().append("td")
          .text(String)
          .attr("class", function(d, i) { return registerCellStyles(i) })
