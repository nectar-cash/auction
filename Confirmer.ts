// import { ethers, Model } from './deps.ts'
// import { config } from './deps.ts'

import reportAddressEvent from './EventReporter.ts'
import { Payment } from './models.ts'
import rpc from './RPCProxy.ts'

// const env = config()

const lookupAndHandleTx = async (txhash: string, createdAt: Date) => {
  const txReceipt = await rpc.getTransactionReceipt(txhash)
  // console.log(txReceipt)
  const currentTime = new Date()
  if (txReceipt && txReceipt.blockNumber > 0) {
    await Payment.where('tx', txhash).update({ included: true })

    const matchingTxs = (await Payment.where('tx', txhash).get()) as Payment[]
    matchingTxs.forEach((payment: Payment) => {
      reportAddressEvent(
        payment.address as string,
        `Auction: Payment to Auction tx ${txReceipt.transactionHash} found in block ${txReceipt.blockNumber}`
      )
    })

    console.log('Found that', txhash, 'was confirmed! Updated.')
  } else if (txReceipt === null && currentTime.getTime() - createdAt.getTime() > 20 * 60 * 1000) {
    // 20 minutes
    await Payment.where('tx', txhash).delete()
    console.log(txhash, 'expired, will no longer check for inclusion.')
  }
}

export default async function confirmTxs() {
  const unconfirmedTxs = (await Payment.where('included', false).get()) as Payment[]

  const uniqueTxs: { [key: string]: Date } = {}
  unconfirmedTxs.forEach((val: Payment) => {
    const tx = val.tx as string
    uniqueTxs[tx] = val.createdAt as Date
  })

  if (Object.keys(uniqueTxs).length > 0) {
    console.log('Checking for', Object.keys(uniqueTxs).length, 'unconfirmed txs')

    for (const txhash of Object.keys(uniqueTxs)) {
      lookupAndHandleTx(txhash, uniqueTxs[txhash])
    }
  }
}
