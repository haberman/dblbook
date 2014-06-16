/** @jsx React.DOM */

function repeat(str, times) {
  return new Array(times + 1).join(str);
}

function assert(val) {
  if (!val) {
    throw "Assertion failed.";
  }
}

function getValueFromIterator(iter) {
  var pair = iter.next();
  assert(!pair.done);
  var ret = pair.value;
  assert(iter.next().done);
  return ret;
}

/*

function setTimeoutRequestAnimationFrame(cb) {
  setTimeout(cb, 1000 / 60);
};

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

function tick() {
  ReactUpdates.flushBatchedUpdates();
  requestAnimationFrame(tick);
}

var ReactRAFBatchingStrategy = {
  isBatchingUpdates: true,

  /**
   * Call the provided function in a context within which calls to `setState`
   * and friends are batched such that components aren't updated unnecessarily.
   * /
  batchedUpdates: function(callback, param) {
    callback(param);
  }
};

requestAnimationFrame(tick);

ReactUpdates.injection.injectBatchingStrategy(ReactRAFBatchingStrategy);
*/

var nbsp = String.fromCharCode(160)

/**
 * A convenience mixin for subscribing to change events on the DB.
 */
var DblbookSubscribeMixin = {
  // Components can call this on any object that can get change notifcations
  // from the DB.  It will cause the component to be re-rendered when the
  // object changes.
  subscribe: function(obj) {
    if (!this.guid) {
      this.guid = dblbook.guid();
    }
    obj.subscribe(this.guid, this.forceUpdate.bind(this));
    this.subscribed.add(obj);
  },

  unsubscribeAll: function() {
    var self = this;
    iterate(this.subscribed.values(), function(obj) { obj.unsubscribe(self.guid); });
    this.subscribed.clear();
  },

  getInitialState: function() {
    this.subscribed = new Set();
    return {}
  },

  // Called right before the component updates.  We clear all existing
  // subscriptions, so that only ones that are "renewed" in render() are
  // kept.
  componentWillUpdate: function() { this.unsubscribeAll(); },

  // Called automatically when the component is being unmounted.
  componentWillUnmount: function() { this.unsubscribeAll(); },
};

/**
 * Component for rendering the accounts page.
 */
var AccountPage = React.createClass({
  mixins: [DblbookSubscribeMixin],

  render: function() {
    var uploadGnucash = <div>
      <br/>
      <br/>
      <br/>
      <br/>
      <div>
        Upload a GnuCash file:<br/><input id="import" type="file" onChange={importGnucash} />
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
    this.subscribe(account);
    this.children.push(
      <Account key={account.data.guid}
               expanded={expanded}
               account={account}
               depth={depth + 1}
               ontoggle={this.onToggle.bind(this, account.data.guid)} />);
    if (expanded) {
      this.renderChildren(account, depth + 1)
    }
  },

  renderChildren: function(account, depth) {
    iterate(account.children.iterator(), function(name, child) {
      this.renderAccount(child, depth, this.state[child.data.guid]);
    }, this);
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
var Account = React.createClass({
  mixins: [DblbookSubscribeMixin],

  // TODO: componentWillReceiveProps?
  componentWillMount: function() {
    this.balance = this.props.account.newBalanceReader();
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
    var str = getValueFromIterator(this.balance.iterator()).toString();
    return <span>{str}</span>;
  },

  render: function() {
    var account = this.props.account;

    this.subscribe(this.balance);
    this.subscribe(account);

    var nameText = <span>
      {repeat(nbsp, this.props.depth * 4)}
      {this.renderTriangle()}
      &nbsp;&nbsp;&nbsp;
      <a href="#">{account.data.name}</a>
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

dblbook.DB.open(function(db) {
  document.db = db;
  React.renderComponent(<AccountPage db={db} />,
                        document.getElementById("content"));
});
