try {
  var s = JSON.parse(localStorage.getItem('h2v_settings'));
  if (s && s.theme === 'light') {
    document.documentElement.setAttribute('data-theme', 'light');
    document.querySelector('meta[name=theme-color]').content = '#f8fafc';
  }
} catch (e) {}
