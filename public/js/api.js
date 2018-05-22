// The Api module is designed to handle all interactions with the server

var Api = (function() {
  var requestPayload;
  var responsePayload;
  var messageEndpoint = '/api/message';
  var pictureEndpoint = '/api/picture';
  // Publicly accessible methods defined
  return {
    sendRequest: sendRequest,
    sendRequestPic:sendRequestPic,
    // The request/response getters/setters are defined here to prevent internal methods
    // from calling the methods without any of the callbacks that are added elsewhere.
    getRequestPayload: function() {
      return requestPayload;
    },
    setRequestPayload: function(newPayloadStr) {
      requestPayload = JSON.parse(newPayloadStr);
    },
    getResponsePayload: function() {
      return responsePayload;
    },
    setResponsePayload: function(newPayloadStr) {
      responsePayload = JSON.parse(newPayloadStr);
    }
  };

  // Send a message request to the server
  function sendRequest(text, context) {
    // Build request payload
    var payloadToWatson = {};
    if (text) {
      payloadToWatson.input = {
        text: text
      };
    }
    if (context) {
      payloadToWatson.context = context;
    }

    // Built http request
    var http = new XMLHttpRequest();
    http.open('POST', messageEndpoint, true);
    http.setRequestHeader('Content-type', 'application/json');
    http.onreadystatechange = function() {
      if (http.readyState === 4 && http.status === 200 && http.responseText) {
        Api.setResponsePayload(http.responseText);
      }
    };

    var params = JSON.stringify(payloadToWatson);
    // Stored in variable (publicly visible through Api.getRequestPayload)
    // to be used throughout the application
    if (Object.getOwnPropertyNames(payloadToWatson).length !== 0) {
      Api.setRequestPayload(params);
    }

    // Send request
    http.send(params);
  }
  function sendRequestPic(picInput, context) {
    // Build request payload

  var payloadToWatson = {};
  if (picInput) {
    payloadToWatson.input = {
      picInput: picInput
    };
  }
  if (context) {
    payloadToWatson.context = context;
  }
  var http = new XMLHttpRequest();
  http.open('POST', pictureEndpoint, true);
  http.setRequestHeader('Content-type', 'application/json');
  http.onreadystatechange = function() {
    if (http.readyState === 4 && http.status === 200 && http.responseText) {
      Api.setResponsePayload(http.responseText);
      var loader = document.getElementById("loader");
      loader.parentElement.removeChild(loader);
      document.getElementById('upload-input').disabled = false;
      
    }
  };
  

  var params = JSON.stringify(payloadToWatson);
  // Stored in variable (publicly visible through Api.getRequestPayload)
  // to be used throughout the application
  if (Object.getOwnPropertyNames(payloadToWatson).length !== 0) {
    Api.setRequestPayload(params);
  }
  document.getElementById('upload-input').disabled = true;
  var chatBoxElement = document.getElementById("scrollingChat");
  var currentDiv = 
  "<div class=\"loading-wrapper segments load \" id=\"loader\">"+
    "<div class=\"from-watson latest top\">"+
      "<div class=\"message-inner\"><span ><p>רק רגע, טוען את התמונה</p></span><img src=\"../img/loaderOld.gif\" style=\"width:auto; height:4%; vertical-align:bottom; margin:0;\">"+
      "</div>"+
    "</div>"+
  "</div>";
  chatBoxElement.innerHTML += currentDiv;

  // Scroll to the latest message sent by the user
  var scrollEl = chatBoxElement.getElementsByClassName("from-watson latest")[0];
  if (scrollEl) {
    scrollingChat.scrollTop = scrollEl.offsetTop;
  }
  //document.getElementById("loader").classList.remove("hide");
  http.send(params);

}
}());
