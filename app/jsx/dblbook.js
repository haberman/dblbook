/** @jsx React.DOM */

function repeat(str, times) {
  return new Array(times + 1).join(str);
}

var nbsp = String.fromCharCode(160)

/**
 * A convenience mixin for subscribing to change events on the DB.
 */
var DblbookSubscribeMixin = {
  // Components can call this on any object that can get change notifcations
  // from the DB.  It will cause the component to be re-rendered when the
  // object changes.
  subscribe: function(obj) {
    this.db = obj.db;
    obj.db.subscribe(this, obj, this.forceUpdate.bind(this));
  },

  // Called right before the component updates.  We clear all existing
  // subscriptions, so that only ones that are "renewed" in render() are
  // kept.
  componentWillUpdate: function() {
    if (this.db) {
      this.db.unsubscribe(this);
    }
  },

  // Called automatically when the component is being unmounted.
  componentWillUnmount: function() {
    if (this.db) {
      this.db.unsubscribe(this);
    }
  }
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
    if (this.props.db.getRealRoot().children.size == 0) {
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

  renderChildren: function(account, depth, children) {
    iterate(account.children.iterator(), function(name, child) {
      this.subscribe(child);
      var expanded = this.state[child.data.guid];
      children.push(
        <Account key={child.data.guid}
                 expanded={expanded}
                 account={child}
                 depth={depth + 1}
                 ontoggle={this.onToggle.bind(this, child.data.guid)} />);
      if (expanded) {
        this.renderChildren(child, depth + 1, children)
      }
    }, this);
  },

  render: function() {
    var children = []
    this.subscribe(this.props.root);
    this.renderChildren(this.props.root, 0, children);
    children.push(<tr key="Net Worth">
      <td><b>Net Worth</b></td>
      <td>$2000</td>
    </tr>);

    return <table className="pure-table pure-table-horizontal" style={{"width": "100%"}}>
      <thead>
        <tr>
          <th>{repeat(nbsp, 8)}Account</th>
          <th>Balance</th>
        </tr>
      </thead>

      <tbody>
        {children}
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
    this.balance = this.props.account.newTimeSeries();
    this.subscribe(this.props.account);
    this.subscribe(this.balance);
  },

  componentWillUnmount: function() {
    this.balance.release();
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
    var str = this.balance.values[0];
    return <span>{str}</span>;
  },

  render: function() {
    return <tr>
        <td>
          {repeat(nbsp, this.props.depth * 4)}
          {this.renderTriangle()}
          &nbsp;&nbsp;&nbsp;
          <a href="#">{this.props.account.data.name}</a>
        </td>
        <td>{this.renderBalance()}&nbsp;</td>
      </tr>;
  }
});

dblbook.DB.open(function(db) {
  document.db = db;
  React.renderComponent(<AccountPage db={db} />,
                        document.getElementById("content"));
});
