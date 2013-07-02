


$(function() {
  
  //TABS
  function reloadtabs(){
    
    var hash = document.location.hash;
    var hashValue = hash.substring(1);
    if(hash == '') hashValue = 'intro'
     
    // console.log('Hash Value: ' + hashValue);

    // var isOn = $('.info.'+hashValue).hasClass('active');

    // console.log('isOn: ' + isOn);

    $('.info').removeClass('active');
    $('.info.'+hashValue).addClass('active');

    // if (!isOn) {
    // };
    
  }
  
  window.onhashchange = reloadtabs;
  reloadtabs();
  
  //
  $('.account .logout').click(function() {
    
    $.getJSON('/logout', function (user) {
      window.location = '/';
    });
    
    return false;
  })
  
  
})