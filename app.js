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
var VisualRecognitionV3 = require('watson-developer-cloud/visual-recognition/v3');
const fs = require('fs'); // file system for loading JSON

// cfenv provides access to your Cloud Foundry environment
// for more info, see: https://www.npmjs.com/package/cfenv
// const cfenv = require('cfenv');
// const url = require('url');
// const http = require('http');
// const https = require('https');

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

var cloudant;

var fileToUpload;

var dbCredentials = {
    dbName: 'my_sample_db'
};

function getDBCredentialsUrl(jsonData) {
  var vcapServices = JSON.parse(jsonData);
  // Pattern match to find the first instance of a Cloudant service in
  // VCAP_SERVICES. If you know your service key, you can access the
  // service credentials directly by using the vcapServices object.
  for (var vcapService in vcapServices) {
      if (vcapService.match(/cloudant/i)) {
          return vcapServices[vcapService][0].credentials.url;
      }
  }
}
/*
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
  }

  cloudant = require('cloudant')(dbCredentials.url);

  // check if DB exists if not create
  cloudant.db.create(dbCredentials.dbName, function(err, res) {
      if (err) {
          console.log('Could not create new db: ' + dbCredentials.dbName + ', it might already exist.');
      }
  });

  db = cloudant.use(dbCredentials.dbName);
}

initDBConnection();
*/

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
const conversation = watson.conversation({
  url: conversationUrl,
  username: conversationUsername,
  password: conversationPassword,
  version_date: '2018-02-16',
  version: 'v1'
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

var vcApi = vcrCredentials['api_key'] || process.env.VC_API;

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
    var workspace = process.env.WORKSPACE_ID;
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
          workspace_id: workspace,
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
    
          console.log("call")
          conversation.message(payload, function(err, data) {
            if (err) {
              console.log(err)
              return res.status(err.code || 500).json(err);
            } else {
              if(data.context.org){

                data.output.text.push("<iframe width=\"100%\" height=\"50%\" frameborder=\"0\" style=\"border:0\""+
                  "src=\"https://www.google.com/maps/embed/v1/directions?origin="+data.context.org+"&destination=דרך אם המושבות 94 פתח תקווה&key=AIzaSyCU3x1Sf94y2baNCDXNelCNSCEOb_murao\" allowfullscreen></iframe>")
                  delete data.context.org;
              }
              else if(data.context.lastNtrans){
                var pos=0;
                
                var resText="<table class=\"trans\" dir=\"rtl\"><tr  dir=\"rtl\"><th>תאריך</th><th>שם העסק</th><th>סכום</th></tr>";
                var cloudantquery ={
                  "selector": {},
                  "fields": [
                    "bname",
                    "t_date",
                    "amount"
                  ],
                  "sort": [{
                    "t_date": "desc"
                  }]
                };
                dbTransactions.find(cloudantquery, function (err, resp) {
                for (var i = 0, len = resp.docs.length; i < len; i++){
                var currdoc=resp.docs[i];
                  if(currdoc.bname){
                    var dealDate = new Date(currdoc.t_date)
                    var dealDateString = formatDate(dealDate,"/")
                    resText+="<tr><td>"+dealDateString+"</td><td>"+currdoc.bname+"</td><td>₪"+currdoc.amount.toFixed(2)+"</td></tr>";
                  }
                }
                resText+="</table>";
                data.output.text[pos]=resText;
                return res.json(data);
                })
              }
              
              console.log('conversation.message :: ', JSON.stringify(data));
              return res.json(data);
            }
          });
        
  }
});


/**
*
* Looks for actions requested by conversation service and provides the requested data.
*
**/
function checkForLookupRequests(data, callback) {
  console.log('checkForLookupRequests');

  if (data.context && data.context.action && data.context.action.lookup && data.context.action.lookup != 'complete') {
    const payload = {
      workspace_id: workspaceID,
      context: data.context,
      input: data.input
    };

    // conversation requests a data lookup action
    if (data.context.action.lookup === LOOKUP_BALANCE) {
      console.log('Lookup Balance requested');
      // if account type is specified (checking, savings or credit card)
      if (data.context.action.account_type && data.context.action.account_type != '') {
        // lookup account information services and update context with account data
        bankingServices.getAccountInfo(7829706, data.context.action.account_type, function(err, accounts) {
          if (err) {
            console.log('Error while calling bankingServices.getAccountInfo ', err);
            callback(err, null);
            return;
          }
          const len = accounts ? accounts.length : 0;

          const appendAccountResponse = data.context.action.append_response && data.context.action.append_response === true ? true : false;

          let accountsResultText = '';

          for (let i = 0; i < len; i++) {
            accounts[i].balance = accounts[i].balance ? numeral(accounts[i].balance).format('INR 0,0.00') : '';

            if (accounts[i].available_credit)
              accounts[i].available_credit = accounts[i].available_credit ? numeral(accounts[i].available_credit).format('INR 0,0.00') : '';

            if (accounts[i].last_statement_balance)
              accounts[i].last_statement_balance = accounts[i].last_statement_balance ? numeral(accounts[i].last_statement_balance).format('INR 0,0.00') : '';

            if (appendAccountResponse === true) {
              accountsResultText += accounts[i].number + ' ' + accounts[i].type + ' Balance: ' + accounts[i].balance + '<br/>';
            }
          }

          payload.context['accounts'] = accounts;

          // clear the context's action since the lookup was completed.
          payload.context.action = {};

          if (!appendAccountResponse) {
            console.log('call conversation.message with lookup results.');
            conversation.message(payload, function(err, data) {
              if (err) {
                console.log('Error while calling conversation.message with lookup result', err);
                callback(err, null);
              } else {
                console.log('checkForLookupRequests conversation.message :: ', JSON.stringify(data));
                callback(null, data);
              }
            });
          } else {
            console.log('append lookup results to the output.');
            // append accounts list text to response array
            if (data.output.text) {
              data.output.text.push(accountsResultText);
            }
            // clear the context's action since the lookup and append was completed.
            data.context.action = {};

            callback(null, data);
          }
        });
      }
    } else if (data.context.action.lookup === LOOKUP_TRANSACTIONS) {
      console.log('Lookup Transactions requested');
      bankingServices.getTransactions(7829706, data.context.action.category, function(err, transactionResponse) {
        if (err) {
          console.log('Error while calling account services for transactions', err);
          callback(err, null);
        } else {
          let responseTxtAppend = '';
          if (data.context.action.append_total && data.context.action.append_total === true) {
            responseTxtAppend += 'Total = <b>' + numeral(transactionResponse.total).format('INR 0,0.00') + '</b>';
          }

          if (transactionResponse.transactions && transactionResponse.transactions.length > 0) {
            // append transactions
            const len = transactionResponse.transactions.length;
            const sDt = new Date(data.context.action.startdt);
            const eDt = new Date(data.context.action.enddt);
            if (sDt && eDt) {
              for (let i = 0; i < len; i++) {
                const transaction = transactionResponse.transactions[i];
                const tDt = new Date(transaction.date);
                if (tDt > sDt && tDt < eDt) {
                  if (data.context.action.append_response && data.context.action.append_response === true) {
                    responseTxtAppend +=
                      '<br/>' + transaction.date + ' &nbsp;' + numeral(transaction.amount).format('INR 0,0.00') + ' &nbsp;' + transaction.description;
                  }
                }
              }
            } else {
              for (let i = 0; i < len; i++) {
                const transaction1 = transactionResponse.transactions[i];
                if (data.context.action.append_response && data.context.action.append_response === true) {
                  responseTxtAppend +=
                    '<br/>' + transaction1.date + ' &nbsp;' + numeral(transaction1.amount).format('INR 0,0.00') + ' &nbsp;' + transaction1.description;
                }
              }
            }

            if (responseTxtAppend != '') {
              console.log('append lookup transaction results to the output.');
              if (data.output.text) {
                data.output.text.push(responseTxtAppend);
              }
              // clear the context's action since the lookup and append was completed.
              data.context.action = {};
            }
            callback(null, data);

            // clear the context's action since the lookup was completed.
            payload.context.action = {};
            return;
          }
        }
      });
    } else if (data.context.action.lookup === LOOKUP_5TRANSACTIONS) {
      console.log('Lookup Transactions requested');
      bankingServices.getTransactions(7829706, data.context.action.category, function(err, transactionResponse) {
        if (err) {
          console.log('Error while calling account services for transactions', err);
          callback(err, null);
        } else {
          let responseTxtAppend = '';
          if (data.context.action.append_total && data.context.action.append_total === true) {
            responseTxtAppend += 'Total = <b>' + numeral(transactionResponse.total).format('INR 0,0.00') + '</b>';
          }

          transactionResponse.transactions.sort(function(a1, b1) {
            const a = new Date(a1.date);
            const b = new Date(b1.date);
            return a > b ? -1 : a < b ? 1 : 0;
          });

          if (transactionResponse.transactions && transactionResponse.transactions.length > 0) {
            // append transactions
            const len = 5; // transaction_response.transactions.length;
            for (let i = 0; i < len; i++) {
              const transaction = transactionResponse.transactions[i];
              if (data.context.action.append_response && data.context.action.append_response === true) {
                responseTxtAppend +=
                  '<br/>' + transaction.date + ' &nbsp;' + numeral(transaction.amount).format('INR 0,0.00') + ' &nbsp;' + transaction.description;
              }
            }
          }
          if (responseTxtAppend != '') {
            console.log('append lookup transaction results to the output.');
            if (data.output.text) {
              data.output.text.push(responseTxtAppend);
            }
            // clear the context's action since the lookup and append was completed.
            data.context.action = {};
          }
          callback(null, data);

          // clear the context's action since the lookup was completed.
          payload.context.action = {};
          return;
        }
      });
    } else if (data.context.action.lookup === 'branch') {
      console.log('************** Branch details *************** InputText : ' + payload.input.text);
      const loc = data.context.action.Location.toLowerCase();
      bankingServices.getBranchInfo(loc, function(err, branchMaster) {
        if (err) {
          console.log('Error while calling bankingServices.getAccountInfo ', err);
          callback(err, null);
          return;
        }

        const appendBranchResponse = data.context.action.append_response && data.context.action.append_response === true ? true : false;

        let branchText = '';

        if (appendBranchResponse === true) {
          if (branchMaster != null) {
            branchText =
              'Here are the branch details at ' +
              branchMaster.location +
              ' <br/>Address: ' +
              branchMaster.address +
              '<br/>Phone: ' +
              branchMaster.phone +
              '<br/>Operation Hours: ' +
              branchMaster.hours +
              '<br/>';
          } else {
            branchText = "Sorry currently we don't have branch details for " + data.context.action.Location;
          }
        }

        payload.context['branch'] = branchMaster;

        // clear the context's action since the lookup was completed.
        payload.context.action = {};

        if (!appendBranchResponse) {
          console.log('call conversation.message with lookup results.');
          conversation.message(payload, function(err, data) {
            if (err) {
              console.log('Error while calling conversation.message with lookup result', err);
              callback(err, null);
            } else {
              console.log('checkForLookupRequests conversation.message :: ', JSON.stringify(data));
              callback(null, data);
            }
          });
        } else {
          console.log('append lookup results to the output.');
          // append accounts list text to response array
          if (data.output.text) {
            data.output.text.push(branchText);
          }
          // clear the context's action since the lookup and append was completed.
          data.context.action = {};

          callback(null, data);
        }
      });
    } 
  } else {
    callback(null, data);
    return;
  }
}

/**
 * Handle setup errors by logging and appending to the global error text.
 * @param {String} reason - The error message for the setup error.
 */
function handleSetupError(reason) {
  setupError += ' ' + reason;
  console.error('The app failed to initialize properly. Setup and restart needed.' + setupError);
  // We could allow our chatbot to run. It would just report the above error.
  // Or we can add the following 2 lines to abort on a setup error allowing Bluemix to restart it.
  console.error('\nAborting due to setup error!');
  process.exit(1);
}

module.exports = app;
