/**
 * Copyright 2017 IBM Corp. All Rights Reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the 'License'); you may not
 * use this file except in compliance with the License. You may obtain a copy of
 * the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an 'AS IS' BASIS, WITHOUT
 * WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the
 * License for the specific language governing permissions and limitations under
 * the License.
 */

'use strict';

require('dotenv').config({
  silent: true
});

const express = require('express'); // app server
const bodyParser = require('body-parser'); // parser for post requests
const watson = require('watson-developer-cloud'); // watson sdk
var AssistantV1 = require('watson-developer-cloud/assistant/v1');
var VisualRecognitionV3 = require('watson-developer-cloud/visual-recognition/v3');
const fs = require('fs'); // file system for loading JSON

// cfenv provides access to your Cloud Foundry environment
// for more info, see: https://www.npmjs.com/package/cfenv
// const cfenv = require('cfenv');
// const url = require('url');
const http = require('http');
const https = require('https');

const numeral = require('numeral');
const vcapServices = require('vcap_services');

const bankingServices = require('./banking_services');
const WatsonDiscoverySetup = require('./lib/watson-discovery-setup');
const WatsonConversationSetup = require('./lib/watson-conversation-setup');

const DEFAULT_NAME = 'watson-banking-chatbot';

const LOOKUP_BALANCE = 'balance';
const LOOKUP_TRANSACTIONS = 'transactions';
const LOOKUP_5TRANSACTIONS = '5transactions';

const app = express();

// Bootstrap application settings
app.use(express.static('./public')); // load UI from public folder
app.use(bodyParser.json({limit: '20mb'}));
app.use('/font-awesome', express.static(__dirname + '/node_modules/font-awesome'));
// setupError will be set to an error message if we cannot recover from service setup or init error.
let setupError = '';

var db;
var db_2;

var cloudant;

var fileToUpload;

var dbCredentials = {
    dbName: 'transactions',
    dbName_2:'branches'
};

function getDBCredentialsUrl(jsonData) {
  var vcapServices = JSON.parse(jsonData);
  // Pattern match to find the first instance of a Cloudant service in
  // VCAP_SERVICES. If you know your service key, you can access the
  // service credentials directly by using the vcapServices object.
  for (var vcapService in vcapServices) {
    console.log(vcapService)
      if (vcapService.match(/cloudant/i)) {
          
          return vcapServices[vcapService][0].credentials.url;
      }
  }
}

function initDBConnection() {
  //When running on Bluemix, this variable will be set to a json object
  //containing all the service credentials of all the bound services
  if (process.env.VCAP_SERVICES) {
      dbCredentials.url = getDBCredentialsUrl(process.env.VCAP_SERVICES);
  } else { //When running locally, the VCAP_SERVICES will not be set

      // When running this app locally you can get your Cloudant credentials
      // from Bluemix (VCAP_SERVICES in "cf env" output or the Environment
      // Variables section for an app in the Bluemix console dashboard).
      // Once you have the credentials, paste them into a file called vcap-local.json.
      // Alternately you could point to a local database here instead of a
      // Bluemix service.
      // url will be in this format: https://username:password@xxxxxxxxx-bluemix.cloudant.com
      dbCredentials.url = getDBCredentialsUrl(fs.readFileSync("vcap-local.json", "utf-8"));
      console.log(dbCredentials.url)
  }
 
  cloudant = require('cloudant')(dbCredentials.url);

  // check if DB exists if not create
  cloudant.db.create(dbCredentials.dbName, function(err, res) {
      db = cloudant.use(dbCredentials.dbName);
      if (err) {
          console.log('Could not create new db: ' + dbCredentials.dbName + ', it might already exist.');
      }
      else{
        var currDoc = JSON.parse(fs.readFileSync("data/cloudant/docs/transaction_1.json", "utf-8"))
        db.insert(currDoc, function(errf, dataDoc) {
          if (errf) {
            console.log('Could not create doc 1 ');
          }
        });
        currDoc = JSON.parse(fs.readFileSync("data/cloudant/docs/transaction_2.json", "utf-8"))
        db.insert(currDoc, function(errf, dataDoc) {
          if (errf) {
            console.log('Could not create doc 2 ');
          }
        });
        currDoc = JSON.parse(fs.readFileSync("data/cloudant/docs/transaction_3.json", "utf-8"))
        db.insert(currDoc, function(errf, dataDoc) {
          if (errf) {
            console.log('Could not create doc 3 ');
          }
        });
        currDoc = JSON.parse(fs.readFileSync("data/cloudant/docs/transaction_4.json", "utf-8"))
        db.insert(currDoc, function(errf, dataDoc) {
          if (errf) {
            console.log('Could not create doc 4 ');
          }
        });
        currDoc = JSON.parse(fs.readFileSync("data/cloudant/docs/transaction_5.json", "utf-8"))
        db.insert(currDoc, function(errf, dataDoc) {
          if (errf) {
            console.log('Could not create doc 5 ');
          }
        });
        currDoc = JSON.parse(fs.readFileSync("data/cloudant/docs/transaction_6.json", "utf-8"))
        db.insert(currDoc, function(errf, dataDoc) {
          if (errf) {
            console.log('Could not create doc 6 ');
          }
        });

        currDoc = JSON.parse(fs.readFileSync("data/cloudant/docs/des.json", "utf-8"))
        db.insert(currDoc, function(errf, dataDoc) {
          if (errf) {
            console.log('Could not create doc des ');
          }
        });
      }
  });
  cloudant.db.create(dbCredentials.dbName_2, function(err, res) {
    db_2 = cloudant.use(dbCredentials.dbName_2);
    if (err) {
        console.log('Could not create new db: ' + dbCredentials.dbName_2 + ', it might already exist.');
    }
    else{
      var currBranch = JSON.parse(fs.readFileSync("data/cloudant/docs/branch_1.json", "utf-8"))
      db_2.insert(currBranch, function(errf, dataDoc) {
        if (errf) {
          console.log('Could not create branch 1 ');
        }
      });
      currBranch = JSON.parse(fs.readFileSync("data/cloudant/docs/branch_2.json", "utf-8"))
      db_2.insert(currBranch, function(errf, dataDoc) {
        if (errf) {
          console.log('Could not create branch 2 ');
        }
      });
    }
  });

  
}

initDBConnection();


// Create the service wrapper
let conversationCredentials = vcapServices.getCredentials('conversation');
let conversationUrl = conversationCredentials.url;
let conversationUsername = conversationCredentials.username || process.env.CONVERSATION_USERNAME;
let conversationPassword = conversationCredentials.password || process.env.CONVERSATION_PASSWORD;;
if (process.env.service_watson_discovery !== undefined) {
  conversationCredentials = JSON.parse(process.env.service_watson_conversation);
  conversationUrl = conversationCredentials['url'];
  conversationUsername = conversationCredentials['username'];
  conversationPassword = conversationCredentials['password'];
}
var conversation = new AssistantV1({
  version: '2018-02-16',
  url: conversationUrl,
  username: conversationUsername,
  password: conversationPassword
});

let workspaceID; // workspaceID will be set when the workspace is created or validated.
const conversationSetup = new WatsonConversationSetup(conversation);
//workspaceID = process.env.WORKSPACE_ID;
const workspaceJson = JSON.parse(fs.readFileSync('data/conversation/workspaces/banking.json'));
const conversationSetupParams = { default_name: DEFAULT_NAME, workspace_json: workspaceJson };
conversationSetup.setupConversationWorkspace(conversationSetupParams, (err, data) => {
  if (err) {
    handleSetupError(err);
    
  } else {
    console.log('Watson Assistant is ready!');
    workspaceID = data ;
  }
  
});

let vcrCredentials = vcapServices.getCredentials('watson_vision_combined');

var vcApi = vcrCredentials['apikey'] || process.env.VC_API;
//var vcApi =  process.env.VC_API;
var visual_recognition = new VisualRecognitionV3({
    
  url: "https://gateway.watsonplatform.net/visual-recognition/api",
  iam_apikey: vcApi,
  version_date: '2018-03-19'
});
// Endpoint to be called from the client side
app.post('/api/message', function(req, res) {
  if (setupError) {
    return res.json({ output: { text: 'The app failed to initialize properly. Setup and restart needed.' + setupError } });
  }
  
  /*fs.writeFile("yo.txt", vcApi, function(err) {
    if(err) {
        return console.log(err);
    }

    console.log("The file was saved!");
}); */
  if (!workspaceID) {
    return res.json({
      output: {
        text: 'Assistant initialization in progress. Please try again.'
      }
    });
  }

  bankingServices.getPerson(7829706, function(err, person) {
    if (err) {
      console.log('Error occurred while getting person data ::', err);
      return res.status(err.code || 500).json(err);
    }

    const payload = {
      workspace_id: workspaceID,
      context: {
        person: person
      },
      input: {}
    };

    // common regex patterns
    const regpan = /^([a-zA-Z]){5}([0-9]){4}([a-zA-Z]){1}?$/;
    // const regadhaar = /^\d{12}$/;
    // const regmobile = /^(?:(?:\+|0{0,2})91(\s*[\-]\s*)?|[0]?)?[789]\d{9}$/;
    if (req.body) {
      if (req.body.input) {
        let inputstring = req.body.input.text;
        console.log('input string ', inputstring);
        const words = inputstring.split(' ');
        console.log('words ', words);
        inputstring = '';
        for (let i = 0; i < words.length; i++) {
          if (regpan.test(words[i]) === true) {
            // const value = words[i];
            words[i] = '1111111111';
          }
          inputstring += words[i] + ' ';
        }
        // words.join(' ');
        inputstring = inputstring.trim();
        console.log('After inputstring ', inputstring);
        // payload.input = req.body.input;
        payload.input.text = inputstring;
      }
      if (req.body.context) {
        // The client must maintain context/state
        payload.context = req.body.context;
      }
    }

    /* if (req.body) {
        if (req.body.input) {
            payload.input = req.body.input;
                        }
        if (req.body.context) {
            // The client must maintain context/state
            payload.context = req.body.context;
        }

    } */

    callconversation(payload);
  });

  app.post('/api/picture', function(req, res) {
    var pic = String(req.body.input.picInput);
    var regex = /^data:.+\/(.+);base64,(.*)$/;
    var matches = pic.match(regex);
    var ext = matches[1];
    var data = matches[2];
    var buffer = new Buffer(data, 'base64');
    var fileName ="fl"+String(Math.floor(Math.random() * 10000000000) + 1  )+"."+ext;
    fs.writeFileSync(fileName, buffer);
    var params = {
      images_file: fs.createReadStream(fileName)
    };
    
    console.log(params)
    visual_recognition.detectFaces(params, function(err, res2) {
      if (err)
        console.log(err);
      else{
        var newContext=req.body.context
        var respText = JSON.stringify(res2, null, 2)
        if (res2.images && res2.images[0].faces  && res2.images[0].faces.length>0){
          var age = res2.images[0].faces[0].age
          var gender = res2.images[0].faces[0].gender.gender
          respText = "גילך המינימלי הוא : " + age.min + " גילך המקסימלי הוא " + age.max + ". המין שלך הוא " +gender
          newContext['gender']=gender;
          newContext['age']=(age.max+age.min)/2
        }
        var inpt = {  text : respText} 
        
        console.log(newContext)
        var payload = {
          workspace_id: workspaceID,
          context:  newContext|| {},
          input: inpt || {}
        };
        
          
        conversation.message(payload, function(err, data) {
          if (err) {
            console.log(err)
            return res.status(err.code || 500).json(err);
          }
          return res.json(data);
        });
        
  
      }
      fs.unlinkSync(fileName);
    });
  });

  /**
   * Send the input to the conversation service.
   * @param payload
   */
  function callconversation(payload) {
    const queryInput = JSON.stringify(payload.input);
    // const context_input = JSON.stringify(payload.context);
    //https://maps.googleapis.com/maps/api/distancematrix/json?origins=%D7%AA%D7%9C%20%D7%90%D7%91%D7%99%D7%91&destinations=%D7%99%D7%A4%D7%95
    // rows[0].elements[0].distance.value
          console.log("call")
          conversation.message(payload, function(err, data) {
            if (err) {
              console.log(err)
              return res.status(err.code || 500).json(err);
            } else {
              if(data.context.org){
                var orgLoc = data.context.org
                var cloudantquery ={
                  "selector": {},
                  "fields": [
                    "b_address"
                  ]
                };
                db_2.find(cloudantquery, function (errBranch, respBranch) {
                  if(errBranch){
                    console.log("err ::",errBranch)
                  }
                  var len=respBranch.docs.length;
                  
            
                  for (var i = 0; i < len; i++){
                    
                    var getUrl = encodeURI('https://maps.googleapis.com/maps/api/distancematrix/json?origins='+orgLoc+'&destinations='+respBranch.docs[i].b_address);
                    https.get(getUrl, (resp) => {
                        let newdata = '';
                        // A chunk of data has been recieved.
                        resp.on('data', (chunk) => {
                            newdata += chunk;
                        });
                      
                        // The whole response has been received. Print out the result.
                        resp.on('end', () => {
                          console.log(newdata)
                          console.log(JSON.parse(newdata).rows[0].elements[0].distance.value)
                      })
                    });
                  }

                  if(data.context.transNumber && typeof data.context.transNumber == 'number' &&  data.context.transNumber<len){
                    len = data.context.transNumber;
                    delete data.context.transNumber;
                  }
                })
                data.output.text.push("<iframe width=\"100%\" height=\"50%\" frameborder=\"0\" style=\"border:0\""+
                  "src=\"https://www.google.com/maps/embed/v1/directions?origin="+data.context.org+"&destination=דרך אם המושבות 94 פתח תקווה&key=AIzaSyDXyWbmNj0Ps7e8wTzYL-jJDoFYs6tNFCs\" allowfullscreen></iframe>")
                  delete data.context.org;
                  return res.json(data);
              }
              else if(data.context.getTransactions && data.context.getTransactions==1){
                
                var resText="<table class=\"trans\" dir=\"rtl\"><tr dir=\"rtl\"><th>תאריך</th><th>סוג פעולה</th><th>זכות ₪</th><th>חובה ₪</th></tr>";
                var cloudantquery ={
                  "selector": {},
                  "fields": [
                    "bname",
                    "t_date",
                    "type",
                    "amount"
                  ],
                  "sort": [{
                    "t_date": "desc"
                  }]
                };
                db.find(cloudantquery, function (err, resp) {
                  if(err){
                    console.log("err ::",err)
                  }
                  var len=resp.docs.length;
                  console.log("len ::",len)
                  if(data.context.transNumber && typeof data.context.transNumber == 'number' &&  data.context.transNumber<len){
                    len = data.context.transNumber;
                    delete data.context.transNumber;
                  }
                  console.log("len ::",len)
                  for (var i = 0; i < len; i++){
                    var currdoc=resp.docs[i];
                      if(currdoc.bname){
                        var type = currdoc.type
                        var dealDate = new Date(currdoc.t_date)
                        var dealDateString = formatDate(dealDate,"/")
                        var credit=""
                        var debit=""
                        if(type=="ח"){
                          debit =currdoc.amount.toFixed(2)
                        }
                        else{
                          credit =currdoc.amount.toFixed(2)
                        }
                        resText+="<tr><td>"+dealDateString+"</td><td>"+currdoc.bname+"</td><td>"+credit+"</td><td>"+debit+"</td></tr>";
                      }
                  }
                  resText+="</table>";
                  console.log(resText)
                  data.output.text.push(resText);
                  console.log(data.output.text)
                  delete data.context.getTransactions;
                  return res.json(data);
                })
              }
              else{
                console.log("out ::",data.output.text);
                //console.log('conversation.message :: ', JSON.stringify(data));
                return res.json(data);
              }
            }
          });
        
  }
});



/**
 * Handle setup errors by logging and appending to the global error text.
 * @param {String} reason - The error message for the setup error.
 */
function formatDate(date,sep) {
  var d = new Date(date),
      month = '' + (d.getMonth() + 1),
      day = '' + d.getDate(),
      year = d.getFullYear();

  if (month.length < 2) month = '0' + month;
  if (day.length < 2) day = '0' + day;
  if(sep=="/")
  {
    return [day,month, year].join('/');
  }
  else{
    return [year, month, day].join('-');
  }
}
function handleSetupError(reason) {
  setupError += ' ' + reason;
  console.error('The app failed to initialize properly. Setup and restart needed.' + setupError);
  // We could allow our chatbot to run. It would just report the above error.
  // Or we can add the following 2 lines to abort on a setup error allowing Bluemix to restart it.
  console.error('\nAborting due to setup error!');
  process.exit(1);
}

module.exports = app;
