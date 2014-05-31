/** @jsx React.DOM */

function repeat(str, times) {
  return new Array(times + 1).join(str);
}

function isEmptyObject(obj) {
  console.log(obj);
  console.log(Object.keys(obj) == 0);
  return Object.keys(obj).length == 0;
}

var nbsp = String.fromCharCode(160)

var AccountList = React.createClass({
  getInitialState: function() {
    return {editing: false};
  },

  render: function() {
    return <div>
      <ul className="account_list">
        <li className="clearfix header">
          <div className="accountlist_name">{repeat(nbsp, 8)}Account</div>
          <div className="accountlist_balance">Balance</div>
        </li>
        <AccountChildren account={this.props.root} depth={0} show={true} />
      </ul>
      <a ng-click="edit()" className="btn clearfix" style={{"float": "right"}}>Edit</a>
    </div>
      ;
  }
});

var Account = React.createClass({
  getInitialState: function() {
    return {expanded: false};
  },

  renderTriangle: function() {
    var cls = "icon-play";
    if (isEmptyObject(this.props.account.children)) {
      cls += " myhide";
    }
    return <i className={cls} onClick={this.props.ontoggle} />
  },

  render: function() {
          //<i ng-show="account.children.length() > 0" class="icon-play" ng-click="toggle()"
          //   ng-style="{ triangleOpen: open }"></i>
    return <li className="clearfix">
        <div className="accountlist_name">
          {repeat(nbsp, this.props.depth * 4)}
          {this.renderTriangle()}
          &nbsp;&nbsp;&nbsp;
          <a href="#">{this.props.account.data.name}</a>
        </div>
        <div className="accountlist_balance">{"$1000"}&nbsp;</div>
      </li>;
  }
});

var AccountChildren = React.createClass({
  getInitialState: function() {
    return {};
  },

  onToggle: function(guid, event) {
    var newState = {};
    newState[guid] = !this.state[guid];
    this.setState(newState);
  },

  makeChildren: function() {
    var children = [];
    for (var childName in this.props.account.children) {
      var child = this.props.account.children[childName];
      var expanded = this.state[child.data.guid];
      children.push(
        <Account key={child.data.guid}
                 account={child}
                 depth={this.props.depth + 1}
                 ontoggle={this.onToggle.bind(this, child.data.guid)} />);
      children.push(
        <AccountChildren key={"childrenOf" + child.data.guid}
                         account={child}
                         depth={this.props.depth + 1}
                         show={expanded} />);
    }
    return children;
  },

  render: function() {
    var style = {"display": this.props.show ? "block" : "none"};
    return <ul className="account_list" style={style}>{this.makeChildren()}</ul>;
  }
});

dblbook.openDB(function(db) {
  var account = db.createAccount({"name":"Test"});
  var sub = db.createAccount({"name":"Sub", "parent_guid":account.data.guid});
  React.renderComponent(<AccountList root={db.getRootAccount()} />,
                        document.getElementById("content"));
});
