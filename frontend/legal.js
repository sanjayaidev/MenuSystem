/* Language switch for the legal pages. Content for each language sits in its own
   <div lang="en"> / <div lang="ar" dir="rtl"> block; this only decides which one is shown.
   Order of choice: ?lang= in the link, then the language picked on the landing page
   (localStorage "redhouse_lang"), then English. Urdu and Chinese visitors get English for now. */
(function(){
  var root = document.documentElement;
  function pick(){
    var q = '';
    try{ q = (new URLSearchParams(location.search).get('lang') || '').toLowerCase(); }catch(_){}
    if(q !== 'en' && q !== 'ar'){
      try{ q = (localStorage.getItem('redhouse_lang') || '').toLowerCase(); }catch(_){ q = ''; }
    }
    return q === 'ar' ? 'ar' : 'en';
  }
  function apply(code){
    root.setAttribute('data-lang', code);
    root.lang = code;
    root.dir = code === 'ar' ? 'rtl' : 'ltr';
    document.querySelectorAll('.lang-switch button').forEach(function(b){
      b.setAttribute('aria-pressed', b.dataset.lang === code ? 'true' : 'false');
    });
    var title = document.querySelector('h1[lang="' + code + '"]');
    if(title) document.title = title.textContent + ' | Red House Catering';
    // keep the language when moving between the legal pages
    document.querySelectorAll('a[data-legal]').forEach(function(a){
      a.href = a.getAttribute('data-legal') + '?lang=' + code;
    });
  }
  document.addEventListener('DOMContentLoaded', function(){
    apply(pick());
    document.querySelectorAll('.lang-switch button').forEach(function(b){
      b.addEventListener('click', function(){
        apply(b.dataset.lang);
        try{ localStorage.setItem('redhouse_lang', b.dataset.lang); }catch(_){}
      });
    });
  });
})();
