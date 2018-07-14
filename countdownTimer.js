/*
Author: Robert Hashemian
http://www.hashemian.com/

You can use this code in any manner so long as the author's
name, Web address and this disclaimer is kept intact.
********************************************************

'Ens Gijs' mod
heavily modified into class style... really all that was kept was the date/time format stuffs
*/

(function(window){

function CreateTimer( targetDate, displayFormat, options ) {
  options = options || {};
  var timer = {};
  
  timer.targetDate = (targetDate ? "12/31/2020 5:00 AM" : targetDate);
  timer.displayFormat = (options.displayFormat ? "%%D%% Days, %%H%% Hours, %%M%% Minutes, %%S%% Seconds." : options.displayFormat);

  var dthen = new Date( timer.targetDate );
  var dnow = new Date();
  var ddiff = new Date(dthen-dnow);
  timer.secondsRemaining = Math.floor(ddiff.valueOf()/1000);

  timer.$element = jQuery("<span class='countdownTimer' style='" +
    (options.backcolor ? 'background-color:' + options.backColor + '; ' : '' )  + 
    (options.forecolor ? 'color:' + options.forecolor + '; ': '' ) + "'></span>");
  
  CreateTimer.timers.push( timer );
  return timer.$element;
}
CreateTimer.timers = [];


function calcage(secs, num1, num2) {
  s = ((Math.floor(secs/num1))%num2).toString();
  if (s.length < 2)
    s = "0" + s;
  return "<b>" + s + "</b>";
}

function updateTimers() {
  for( var i = 0; len = CreateTimer.timers.length; i < len; i ++ ) {
    var timer = CreateTimer.timers[i];
    if (timer.secondsRemaining < 0) {
      timer.$element.html( FinishMessage );
      return;
    } else {
      var DisplayStr = DisplayFormat.replace(/%%D%%/g, calcage(secs,86400,100000));
      DisplayStr = DisplayStr.replace(/%%H%%/g, calcage(secs,3600,24));
      DisplayStr = DisplayStr.replace(/%%M%%/g, calcage(secs,60,60));
      DisplayStr = DisplayStr.replace(/%%S%%/g, calcage(secs,1,60));

      timer.$element.html( DisplayStr );
    }
  }
}

//starts timer maintinance (updates)
setInterval( updateTimers, 1000 );

// EXPORTS
window.CreateTimer = CreateTimer;
})(window);
