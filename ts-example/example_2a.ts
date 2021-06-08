import { Account, Cluster, clusterApiUrl, Connection } from "@solana/web3.js";
import {
  addFeedJob,
  createDataFeed,
  createFulfillmentManager,
  createFulfillmentManagerAuth,
  OracleJob,
  setDataFeedConfigs,
  setFulfillmentManagerConfigs,
  SWITCHBOARD_DEVNET_PID,
} from "@switchboard-xyz/switchboard-api";
import * as fs from "fs";
import resolve from "resolve-dir";
import yargs from "yargs/yargs";

let argv = yargs(process.argv).options({
  'payerFile': {
    type: 'string',
    describe: "Keypair file to pay for transactions.",
    demand: true,
  },
}).argv;

async function main() {
  let cluster = 'devnet';
  let connection = new Connection(`https://api.${cluster}.solana.com/`, 'processed');
  let payerKeypair = JSON.parse(fs.readFileSync(resolve(argv.payerFile), 'utf-8'));
  let payerAccount = new Account(payerKeypair);
  console.log("Creating aggregator...");
  let dataFeedAccount = await createDataFeed(connection, payerAccount, SWITCHBOARD_DEVNET_PID);
  console.log("Adding job to aggregator...");
  let jobAccount = await addFeedJob(connection, payerAccount, dataFeedAccount, [
    OracleJob.Task.create({
      httpTask: OracleJob.HttpTask.create({
        url: "https://api.the-odds-api.com/v3/odds/?sport=basketball_nba&region=us&apiKey=${API_KEY}"
      }),
    }),
    OracleJob.Task.create({
      jsonParseTask: OracleJob.JsonParseTask.create({ path:
        "$.data[?(@.teams[0] == 'Atlanta Hawks' && @.teams[1] == 'Philadelphia 76ers')].sites[?(@.site_key == 'fanduel')].odds.h2h[0]" }),
    }),
  ]);
  console.log(`JOB_PUBKEY=${jobAccount.publicKey}`);

  console.log(`FEED_PUBKEY=${dataFeedAccount.publicKey}`);
  console.log("Creating fulfillment manager...");
  let fulfillmentManagerAccount = await createFulfillmentManager(connection, payerAccount, SWITCHBOARD_DEVNET_PID);
  await setFulfillmentManagerConfigs(connection, payerAccount, fulfillmentManagerAccount, {
    "heartbeatAuthRequired": true,
    "usageAuthRequired": true,
    "lock": false
  });
  console.log(`FULFILLMENT_MANAGER_KEY=${fulfillmentManagerAccount.publicKey}`);
  console.log("Configuring aggregator...");
  await setDataFeedConfigs(connection, payerAccount, dataFeedAccount, {
    "minConfirmations": 1,
    "minUpdateDelaySeconds": 5,
    "fulfillmentManagerPubkey": fulfillmentManagerAccount.publicKey.toBuffer(),
    "lock": false
  });
  console.log(`Creating authorization account to permit account `
              + `${payerAccount.publicKey} to join fulfillment manager ` +
                `${fulfillmentManagerAccount.publicKey}`);
  let authAccount = await createFulfillmentManagerAuth(
    connection,
    payerAccount,
    fulfillmentManagerAccount,
    payerAccount.publicKey, {
      "authorizeHeartbeat": true,
      "authorizeUsage": false
    });
  console.log(`AUTH_KEY=${authAccount.publicKey}`);
  console.log(`Creating authorization account for the data feed. This will be ` +
              `used in part 2b.`);
  let updateAuthAccount = await createFulfillmentManagerAuth(
    connection,
    payerAccount,
    fulfillmentManagerAccount,
    dataFeedAccount.publicKey, {
      "authorizeHeartbeat": false,
      "authorizeUsage": true
    });
  console.log(`UPDATE_AUTH_KEY=${updateAuthAccount.publicKey}`);
}

main().then(
  () => process.exit(),
  err => {
    console.error("Failed to complete action.");
    console.error(err);
    process.exit(-1);
  },
);
