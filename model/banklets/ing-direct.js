/**
 * @fileoverview Banklet for reading data from ING Direct.
 * @author jhaberman@gmail.com (Josh Haberman)
 */

var banklets = {};

banklets.ing = {
  "desc": "ING Direct",
  "domain": "https://secure.ingdirect.com",
  "getTransactions": function(params) {
    function trim(str) {
      return str.replace(/^[\s\n]*/, '').replace(/[\s\n]*$/, '');
    }

    return [
      "https://secure.ingdirect.com",

      // Login page.
      function() {
        $('#ACNID').val(params.username);
        $('#btn_continue').click();
      },

      // "Enter PIN" page.
      function() {
        var pin = params.pin;
        for (var i = 0; i < pin.length; i++) {
          var digit = pin.charAt(i);
          if (digit == "0") digit = "zero";
          var elems = $('#clickOnly img[alt="' + digit + '"]');
          elems[0].onmouseup();
        }
        $('#continueButton').click();
      },

      function() {
        if ($('#tab_eStatementsTab').length == 0) throw "Login failed";
        // Go to transaction detail for the given account.
        document.location =
            "https://secure.ingdirect.com/myaccount/INGDirect/account_history.vm?accountNum=" +
            params.account;
      },

      function(onData, setNextStep) {
        $('#m_history tbody tr').each(function() {
          var txn = {
            "date": Date.parse(trim($('.m_date', this).text())),
            "description": trim($('.m_desc div:first-child', this).text()),
            "commodity": "USD",  // Fix?
            "amount": trim($('.m_amount', this).text()),
            "balance": trim($('.m_balance', this).text())
          }
          if (txn.amount.charAt(0) == "(") {
            txn.amount = "-" + txn.amount.substring(1, txn.amount.length-1);
          }
          onData(txn);
        });

        var older = $('#m_historyLinks a:contains("Older >")');
        if (older.length > 0) {
          document.location = older[0].href
          return 0;  // Run this step again.
        }
      }
    ];
  }
}
