chrome.app.runtime.onLaunched.addListener(function() {
  chrome.app.window.create('account_editor.html', {
    'bounds': {
      'width': 1000,
      'height': 1000
    }
  });
});
