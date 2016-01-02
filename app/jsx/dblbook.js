
import * as React from 'react';
import * as ReactRouter from 'react-router';
import { Link } from 'react-router';
import { importGnucash } from 'importGnucash';
//import { fn } from 'moment';

//var moment = fn;
//cmnsole.log(moment);

function repeat(str, times) {
  return new Array(times + 1).join(str);
}

function assert(val) {
  if (!val) {
    throw "Assertion failed.";
  }
}

// Iterates over a ES6-style iterator.
function iterate(iter, func, funcThis) {
  while (1) {
    var v = iter.next();
    if (v.done) {
      return;
    }

    var val = v.value;

    if (val instanceof Array) {
      // iterate(map.entries(), function(key, val) {});
      func.apply(funcThis, val);
    } else {
      // iterate(map.values(), function(val) {});
      func.call(funcThis, val);
    }
  }
}

function setTimeoutRequestAnimationFrame(cb) {
  setTimeout(cb, 1000 / 60);
}

var requestAnimationFrame;

if (typeof window === 'undefined') {
  requestAnimationFrame = setTimeoutRequestAnimationFrame;
} else {
  requestAnimationFrame = window.requestAnimationFrame ||
    window.webkitRequestAnimationFrame ||
    window.mozRequestAnimationFrame ||
    window.msRequestAnimationFrame ||
    setTimeoutRequestAnimationFrame;
}

var nbsp = String.fromCharCode(160)

var changedSet = new Set();
var redrawScheduled = false;

var onRedraw = function() {
  for (let val of changedSet.values()) {
    val.forceUpdate();
  }
  redrawScheduled = false;
  changedSet.clear();
}

var onChange = function() {
  changedSet.add(this);
  if (!redrawScheduled) {
    requestAnimationFrame(onRedraw);
    redrawScheduled = true;
  }
}

var lastSubscriberId = 0;

/**
 * A convenience mixin for subscribing to change events on the DB.
 */
var DblbookSubscribeMixin = {
  // Components call subscribe() on any Observable object if they want to
  // receive a forceUpdate() call whenver the Observable object changes.
  //
  // subscribe() should only be called from render().  Like the rest of React,
  // we design the subscribe() API to allow render() to be idempotent.  The
  // component does not need to keep track of what objects it has subscribed
  // to, and carefully avoid duplicate subscriptions.  Instead render() should
  // always call subscribe on all objects it wants updates on.  Any previously
  // subscribed objects will be un-subscribed if subscribe() is not called.
  //
  // Unsubscribing and resubscribing to an object can be expensive (subscribing
  // is the signal to the storage layer that certain data needs to be loaded, so
  // it can trigger reloads).  So we include a little logic to optimize the
  // subscribe()/unsubscribe() calls, sort of like React does with the DOM.
  subscribe: function(obj) {
    // Lazily generate an id for this component that we can use to clear our
    // subscriptions later.
    if (!this.subscriberId) {
      this.subscriberId = ++lastSubscriberId;
    }

    if (this.subscribedObjects.has(obj)) {
      // We're already subscribed to this.  Ideally a component shouldn't
      // subscribe to the same object more than once per render().
      console.warn("Component subscribed to the same object twice", this, obj);
    } else if (this.oldSubscribedObjects.has(obj)) {
      // No need to subscribe; we're already subscribed from a previous render
      // call.  But remove it from the old set so we don't clear the
      // subscription after the render.
      this.oldSubscribedObjects.delete(obj);
      this.subscribedObjects.add(obj);
    } else {
      // New subscription.
      obj.subscribe(this.subscriberId, onChange.bind(this));
      this.subscribedObjects.add(obj);
    }
  },

  getInitialState: function() {
    this.subscribedObjects = new Set();
    this.oldSubscribedObjects = new Set();
    return {}
  },

  // These are called before and after render(), but *not* the initial render().
  componentWillUpdate: function() {
    this.oldSubscribedObjects = this.subscribedObjects;
    this.subscribedObjects = new Set();
  },

  componentDidUpdate: function() {
    // Remove subscriptions to any elements we didn't re-subscribe to.
    for (let obj of this.oldSubscribedObjects.values()) {
      obj.unsubscribe(this.subscriberId);
    }
    this.oldSubscribedObjects = null;
  },

  // Called automatically when the component is being unmounted.
  componentWillUnmount: function() {
    // Unsubscribe from all.
    var self = this;
    for (let obj of this.subscribedObjects.values()) {
      obj.unsubscribe(self.guid);
    }
    this.subscribedObjects.clear();
  },
};

function importGnucash2(event) {
  console.log("Import GnuCash: ", event);
  let reader = new FileReader();
  reader.onload = (function(e) {
    importGnucash(reader.result, document.db);
  });
  reader.onerror = (function(e) {
  });
  reader.readAsText(event.target.files[0]);
}

/**
 * Component for rendering the accounts page.
 */
export var AccountPage = React.createClass({
  mixins: [DblbookSubscribeMixin],

  render: function() {
    var uploadGnucash = <div>
      <br/>
      <br/>
      <br/>
      <br/>
      <div>
        Upload a GnuCash file:<br/><input id="import" type="file" onChange={importGnucash2} />
      </div>
    </div>;

    this.subscribe(this.props.db.getRealRoot());
    if (this.props.db.getRealRoot().children.size != 0) {
      uploadGnucash = null;
    }

    return <div>
      <h2>Assets and Liabilities</h2>
      <AccountList root={this.props.db.getRealRoot()} key="REAL" />
      <h2>Income and Expenses</h2>
      <AccountList root={this.props.db.getNominalRoot()} key="NOMINAL" />
      <br/>
      <a ng-click="edit()" className="pure-button" style={{"float": "right"}}>Edit Accounts</a>
      {uploadGnucash}
    </div>;
  }
});

/**
 * Component for rendering the account list.
 */
var AccountList = React.createClass({
  mixins: [DblbookSubscribeMixin],

  getInitialState: function() {
    return {editing: false};
  },

  onToggle: function(guid, e) {
    var newState = {};
    newState[guid] = !this.state[guid];
    this.setState(newState);
  },

  renderAccount: function(account, depth, expanded) {
    var onToggle = this.onToggle.bind(this, account.data.guid);
    this.subscribe(account);
    this.children.push(
      <AccountListElement key={account.data.guid}
                          expanded={expanded}
                          account={account}
                          depth={depth + 1}
                          ontoggle={onToggle} />);
    if (expanded) {
      this.renderChildren(account, depth + 1)
    }
  },

  renderChildren: function(account, depth) {
    for (let [name, child] of account.children.iterator()) {
      this.renderAccount(child, depth, this.state[child.data.guid]);
    }
  },

  render: function() {
    this.children = [];
    this.renderChildren(this.props.root, 0);
    this.renderAccount(this.props.root, 0, false);

    return <table className="pure-table pure-table-horizontal" style={{"width": "100%"}}>
      <thead>
        <tr>
          <th>{repeat(nbsp, 8)}Account</th>
          <th>Balance</th>
        </tr>
      </thead>

      <tbody>
        {this.children}
      </tbody>
    </table>;
  }
});

/**
 * Component for rendering a single account.
 */
var AccountListElement = React.createClass({
  mixins: [DblbookSubscribeMixin],

  // TODO: componentWillReceiveProps?
  componentWillMount: function() {
    this.balance = this.props.account.newBalanceReader({"frequency": "FOREVER"});
  },

  renderTriangle: function() {
    // We generate a hidden one so the spacing is right for leaf accounts.
    var cls = "fa fa-play unselectable";
    if (this.props.account.children.size == 0) {
      cls += " myhide";
    }
    if (this.props.expanded) {
      cls += " triangleOpen";
    }
    return <i className={cls} onClick={this.props.ontoggle} />;
  },

  renderBalance: function() {
    var str = this.balance.getPoints()[0].endBalance.toString();
    return <span>{str}</span>;
  },

  render: function() {
    var account = this.props.account;
    var href = "#account/" + account.data.guid;

    this.subscribe(this.balance);
    this.subscribe(account);

    var nameText = <span>
      {repeat(nbsp, this.props.depth * 4)}
      {this.renderTriangle()}
      &nbsp;&nbsp;&nbsp;
      <Link to="account" params={{guid: account.data.guid}}>
        {account.data.name}
      </Link>
    </span>;

    if (account.data.guid == "REAL_ROOT") {
      nameText = <b>Net Worth</b>;
    } else if (account.data.guid == "NOMINAL_ROOT") {
      nameText = <b>Total Income/Expense</b>;
    }

    return <tr>
        <td>{nameText}</td>
        <td>{this.renderBalance()}&nbsp;</td>
      </tr>;
  }
});

var TransactionList = React.createClass({
  mixins: [DblbookSubscribeMixin],

  render: function() {
    this.subscribe(this.props.reader);
    this.entries = [];

    for (let entry of this.props.reader.getEntries()) {
      //var ts = moment(txn.data.timestamp/1000);
      // <td>{ts.format("YYYY-MM-DD") + nbsp + ts.format("HH:mm")}</td>
      this.entries.push(<tr key={entry.entry.txn.data.guid}>
        <td>{entry.entry.getDate().toISOString().substring(0, 10)}</td>
        <td>{entry.entry.getDescription()}</td>
        <td>{entry.entry.getAmount().toString()}</td>
        <td>{entry.balance.toString()}</td>
      </tr>);
    }

    return <table className="pure-table pure-table-horizontal" style={{"width": "100%"}}>
      <thead>
        <tr>
          <th>Date</th>
          <th>Description</th>
          <th>Amount</th>
          <th>Balance</th>
        </tr>
      </thead>

      <tbody>
        {this.entries}
      </tbody>
    </table>;
  }
});

export var Account = React.createClass({
  mixins: [ReactRouter.State, DblbookSubscribeMixin],
  render: function() {
    var guid = this.getParams().guid;
    var account = this.props.db.getAccountByGuid(guid);
    var reader = account.newEntryReader({startDate: "2014-01-01", endDate: "2014-12-31"});
    this.subscribe(account);
    return <div>
      <h1>Account Details: {account.data.name}</h1>
      <h1>Transaction List</h1>
      <TransactionList reader={reader} />
    </div>
  }
});

var NotFound = React.createClass({
  render: function() {
    return <h1>Not found!</h1>
  }
});
