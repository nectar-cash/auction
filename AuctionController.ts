import { Payment } from './models.ts'
import { BigNumber, BigNumberish, ethers } from './deps.ts'
import { config } from './deps.ts'

import { AUCTION_DURATION } from './deps.ts'
import {
  TransactionIntent,
  NectarOptions,
  TransactionBundle,
  UnknownTransactionBundle,
  BundleTransactionHash,
} from './deps.ts'

interface StoredTransactions {
  [hash: string]: {
    tx: TransactionIntent
    options?: NectarOptions
    bids: Bids
  }
}

interface Bids {
  [bidder: string]: {
    bundle: TransactionBundle
    bid: BigNumberish
  }
}

const env = config()

export default class AuctionController {
  private _transactions: StoredTransactions

  constructor() {
    this._transactions = {}
  }

  async auctionTransaction(
    hash: string,
    tx: TransactionIntent,
    options?: NectarOptions
  ): Promise<{
    hasWinner: boolean
    bundle: TransactionBundle | undefined
  }> {
    // TODO handle repeat / ongoing auctions
    this._transactions[hash] = {
      tx,
      options: options ?? {},
      bids: {},
    }

    await new Promise((resolve) => setTimeout(resolve, AUCTION_DURATION))

    const highestBid = this._getHighestBid(hash)

    if (!highestBid) {
      return {
        hasWinner: false,
        bundle: undefined,
      }
    }

    console.log('Highest Bid!', highestBid)
    const bid = BigNumber.from(highestBid.bid)

    const auctionAddress = env['AUCTION_ADDRESS']
    const userAddress = tx.from || ethers.constants.AddressZero // TODO check for 'from' before accepting auction
    const auctionAllocationValue = bid.mul(5).div(100)
    const userAllocationValue = bid.sub(auctionAllocationValue)

    await Payment.create([
      {
        address: userAddress,
        value: userAllocationValue.toString()
      },
      {
        address: auctionAddress,
        value: auctionAllocationValue.toString()
      }
    ])

    return {
      hasWinner: true,
      bundle: highestBid.bundle,
    }
  }

  bidOnTransaction(bidder: string, bundle: UnknownTransactionBundle) {
    console.log('Bundle from:', bidder, bundle)
    const auctionAddress = env['AUCTION_ADDRESS']

    let payments = BigNumber.from(0)
    let userTxIndex = -1
    for (const [index, item] of bundle.entries()) {
      if (item.hash) {
        if (userTxIndex >= 0) {
          console.error('multiple user transactions in bundle')
          return
        } else {
          userTxIndex = index
        }
      }
      if (item.signedTransaction) {
        const parsedTx = ethers.utils.parseTransaction(item.signedTransaction)
        // console.log('parsed tx', parsedTx)
        if (parsedTx.to && parsedTx.to === auctionAddress && parsedTx.data === '0x') {
          // console.log('parsed tx data', parsedTx.data)
          const txValue = BigNumber.from(parsedTx.value)
          payments = payments.add(txValue)
        }
      }
    }

    const txHash = bundle[userTxIndex] as BundleTransactionHash
    const transaction = this._transactions[txHash.hash]
    console.log('Bid value:', ethers.utils.formatEther(payments))

    if (transaction && transaction.bids) {
      transaction.bids[bidder] = {
        bundle: bundle as TransactionBundle,
        bid: payments,
      }
      // console.log('added bid', bundle, payments)
    }
  }

  private _getHighestBid(hash: string):
    | {
        bidder: string
        bundle: TransactionBundle
        bid: BigNumberish
      }
    | undefined {
    const transaction = this._transactions[hash]

    let highestBid = {
      bidder: ethers.constants.AddressZero as string,
      bundle: [] as TransactionBundle,
      bid: BigNumber.from('0'),
    }

    if (transaction) {
      for (const bidder of Object.keys(transaction.bids)) {
        const bid = transaction.bids[bidder]
        const amount = BigNumber.from(bid.bid)

        if (amount.gt(highestBid.bid)) {
          highestBid = { bidder, bundle: bid.bundle, bid: amount }
        }
      }
    }

    return highestBid.bidder == ethers.constants.AddressZero ? undefined : highestBid
  }
}
