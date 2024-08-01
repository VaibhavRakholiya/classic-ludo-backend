var axios = require("axios");
let client_api = process.env.CLIENT_API
let base_url= process.env.BASE_URL
let api_key= process.env.BASE_KEY
let RestAPIEndPoint = "http://65.0.225.210:4500/api/v1/";

if(client_api=="true"){
    RestAPIEndPoint= base_url
}
console.log("API", RestAPIEndPoint)
module.exports = {

    //dedcut money API call (return true if success=true in response)
    deductMoney: async function (data) {
        console.log("in deduct money........", RestAPIEndPoint,JSON.stringify(data));
        data = JSON.stringify(data);
        var contentLength = data.length;
        try{
        // return new Promise(async (resolve, reject) => {
            const resp = await axios.post(`${RestAPIEndPoint}capermint-match-status`,data,
                {headers: {
                    'content-type': 'application/json',
                    'Access-Control-Allow-Origin': '*',
                    "Content-Length": contentLength,
                    "api-key": api_key,
                },}
            );
            console.log("response", resp.data.success);

            if (resp.data.success) return true;
            else {
                console.log("Deduct money error");
                return false
            }
    }catch(error){
        console.log("Error here", error)
    }
    },

    //winner money distribution API call (return true if success=true in response)
    winnerDistribution: async function (data) {
        console.log("in win money distribution........", JSON.stringify(data), RestAPIEndPoint);
        data = JSON.stringify(data);
        var contentLength = data.length;
        try{
        
            const resp = await axios.post(`${RestAPIEndPoint}capermint-match-result`,data,
                {headers: {
                    'content-type': 'application/json',
                    'Access-Control-Allow-Origin': '*',
                    "Content-Length": contentLength,
                    "api-key": api_key,
                },}
            );
            console.log("response", resp.data.success);

            if (resp.data.success) return true;
            else {
                console.log("Winner money distribution error");
                return false;
            }
    }catch(error){
        console.log("Error here", error)
    }
    },
}