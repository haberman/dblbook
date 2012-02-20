
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
  return [
      "<i class='icon-lock' style='visibility:hidden'></i>",
      txn.txn.date,
      txn.txn.description,
      new dblbook.Decimal(txn.txn.amount),
      txn.balance
  ];
}

function registerCellStyles(i) {
  return new Array("", "", "", "amount", "balance")[i];
}

d3.select("#register tbody").selectAll("tr")
  .data(accounts[0].txns_with_balance)
    .enter().append("tr").selectAll("td")
      .data(function(t) { return registerRow(t) })
        .enter().append("td")
          .html(String)
          .attr("class", function(d, i) { return registerCellStyles(i) })

var lockEndRow = 5;

var tr = $('#register tr');
tr.mouseenter(function() {
  $(this).find('i')
      .css("visibility", "visible")
      .css("opacity", this.sectionRowIndex == lockEndRow ? "1" : "0.4");
});
tr.mouseleave(function() {
  $(this).find('i')
      .css("visibility", this.sectionRowIndex == lockEndRow ? "visible" : "hidden");
});

$('#register i').click(function() {
  lockEndRow = this.parentNode.parentNode.sectionRowIndex;
  restyleTableForLock();
});

function restyleTableForLock() {
  $('#register tbody tr').each(function(i, tr) {
    $(tr).toggleClass("locked", i <= lockEndRow)
    if (i == lockEndRow) {
      $(tr).find('i')
          .css("visibility", "visible")
          .css("opacity", "1");
    } else {
      $(tr).find('i')
          .css("visibility", "hidden")
    }
  });
}

restyleTableForLock();
