/**
 * @fileoverview Code to define and execute scrapelets, which remotely control
 * and receive data from another browser tab.  Nothing about the scrapelets
 * definition is inherently browser-specific, but at the moment only Chrome
 * support is implemented.
 *
 * A scrapelet is a function that returns a series of steps for controlling
 * another browser window.  Each step is a function that runs inside the
 * context of the controlled window, which makes it very easy to manipulate the
 * DOM (particularly forms and buttons) of the target document.  The scrapelet
 * can also yield JavaScript data back to the controlling tab.  This can be a
 * relatively robust way of extracting data from websites that don't offer an
 * API (it is robust as long as the page's HTML structure doesn't change).
 *
 * For example, here is a scrapelet that can download a list of accounts from
 * ING direct, given a username and PIN.
 *
 * function getIngAccounts(params) {
 *   return [
 *     "https://secure.ingdirect.com",
 *
 *     // Login page.
 *     function() {
 *       $('#ACNID').val(params.username);
 *       $('#btn_continue').click();
 *     },
 *
 *     // "Enter PIN" page.
 *     function() {
 *       var pin = params.pin;
 *       for (var i = 0; i < pin.length; i++) {
 *         var digit = pin.charAt(i);
 *         if (digit == "0") digit = "zero";
 *         var elems = $('#clickOnly img[alt="' + digit + '"]');
 *         elems[0].onmouseup();
 *       }
 *       $('#continueButton').click();
 *     },
 *
 *     // "Account Summary" page.
 *     function(onData) {
 *       if ($('#tab_eStatementsTab').length == 0) throw "Login failed";
 *       $('deposittable tbody tr').each(function() {
 *         // Yield the description back to the controlling tab.
 *         onData($('.m_type', this).text());
 *       });
 *     },
 *   ];
 * }
 *
 * @author jhaberman@gmail.com (Josh Haberman)
 */

/**
 * Class for running a callback once a bunch of other callbacks have run.
 */
var Barrier = function() {
  this.count = 1;
  var obj = this;
  this.func = function() {
    if (--obj.count == 0) obj.callback();
  }
}

Barrier.prototype.get = function() {
  this.count++;
  return this.func;
}

Barrier.prototype.run = function(callback) {
  this.callback = callback;
  this.func();
}

/**
 * Creates a new browser tab and runs the given scrapelet on it.
 * @param {jsFile} The file in which the scrapelet is defined.
 * @param {scrapeletSym} A string containing the scrapelet's name in jsFile.
 * @param {params} An object that supplies params to the scrapelet.
 */
function Scrape(jsFile, scrapeletSym, params, onData) {
  var scrapelet;
  var code = "scrapelet = " + scrapeletSym + "(" + JSON.stringify(params) + ");";
  var tabId;
  var step = 0;
  var next = 1;
  function runNextStep() {
    if (typeof(scrapelet[step]) != "function") {
      throw typeof(step) + " " + step + "/" + scrapelet.length;
    }
    // Load the scrapelet and other required files in the controlled tab.
    // Once they have been loaded, run the appropriate step of the scrapelet.
    var b = new Barrier()
    chrome.tabs.executeScript(tabId, {"file": jsFile}, b.get());
    chrome.tabs.executeScript(tabId, {"file": "scrape.js"}, b.get());
    chrome.tabs.executeScript(tabId, {"file": "jquery.js"}, b.get());
    b.run(function() {
      var c = code + 'RunScrapeletStep(scrapelet, ' + step + ');';
      chrome.tabs.executeScript(tabId, { "code": c });
    });
  }
  chrome.tabs.onUpdated.addListener(function(t, changeInfo) {
    if (!next || t != tabId || changeInfo.status != "complete") return;
    step = next;
    next = undefined;
    if (step < scrapelet.length) runNextStep();
  });

  // The controlled tab sends us messages to yield scraped data or to indicate
  // completion of a step (and an indication of which step should be next).
  chrome.extension.onConnect.addListener(function(port) {
    if (!port.sender.tab || port.sender.tab.id != tabId) return;
    if (port.name == "meta") {
      port.onMessage.addListener(function(msg) {
        next = msg;
      })
    } else {
      port.onMessage.addListener(function(msg) { onData(msg); });
    }
  });

  // To kick off the scrapelet we load it and navigate to the start URL.
  $.getScript(jsFile, function() {
    eval(code);
    chrome.tabs.create({"url": scrapelet[0], "active": true}, function(tab) {
      tabId = tab.id;
    });
  });
}

/**
 * The code that runs inside the controlled browser's window.
 */
function RunScrapeletStep(scrapelet, step) {
  // Our goal is to run only after document.onload has run in the target, but
  // there appears to be no robust way to test this; see:
  //   http://code.google.com/p/chromium/issues/detail?id=114890
  //
  // So our best effort is to wait until 100ms after document.readyState is
  // set to "complete".
  function maybeReg() {
    if (document.readyState == "complete") reg();
    else setTimeout(maybeReg, 100);
  }
  function reg() {
    setTimeout(doScrapelet, 100);
  }
  function doScrapelet() {
    var metaPort = chrome.extension.connect({"name": "meta"});
    var dataPort = chrome.extension.connect();
    function send(val) { dataPort.postMessage(val); }
    var ret = scrapelet[step](send);
    // Send a message back to our controlling window indicating completion and
    // the next step to run.
    metaPort.postMessage(step + (typeof(ret) == "number" ? ret : 1));
  }
  maybeReg();
}
