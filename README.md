#### Description
A sample node application that is designed to be run as batch job to export all released drawings to a local directory

#### Requirements
Git, Nodejs and Npm should be installed. **credentials.json** should be populated

#### Running locally
Clone this github repo locally and run the below command to install all the dependencies.

    $ npm install

Run the application with below command after updating api key credentials

    $ node drawingexport.js --stack foobar --export-dir /tmp/sample

When the application is run first time, it will try to export all released drawings to PDF since epoch.
When run the second time it will use the information in **pdfoutput/lastexport.json** to only process
drawings that have not already been exported. This application is designed to be run as nightly job to
extract all new released drawings. All failed exports should be logged and also stored in **lastexport.json**

#### Storing credentials in *credentials.json*
This sample expects api keys to make export calls.  Use dev portal to generate api keys as a company admin and
save in this format to input. The companyId should be your real company id

    {
        "foobar": {
            "url": "https://enterprisename.onshape.com/",
            "companyId": "605dc2d3797ba41b1af31718",
            "accessKey": "XXXXXXXXXXXXXXX",
            "secretKey": "YYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYY"
        }
    }

#### Supported options

>--stack foobar

To pick a particular api key from *credentials.json*

>--export-dir /tmp/sample

To export all pdfs to different folder. By default it create a folder **pdfoutput** to store drawing exports.

#### Logging

The application logs both to console and a file called main.log. Both of these can be configured by **utils/logger.js**
Refer to [log4js](https://log4js-node.github.io/log4js-node/) for additional logging configurations