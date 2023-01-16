import { Payment } from './models.ts'
import { BigNumber, BigNumberish, ethers } from './deps.ts'
import { config } from './deps.ts'

import { AUCTION_DURATION } from './deps.ts'
import { TransactionIntent, NectarOptions, TransactionBundle, BundleTransactionHash } from './deps.ts'
import reportAddressEvent from './EventReporter.ts'

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
    bidTx: string
  }
}

const env = config()

export default class AuctionController {
  private _transactions: StoredTransactions

  constructor() {
    this._transactions = {}
  }

  removeTransaction(hash: string) {
    delete this._transactions[hash]
  }

  hasTransaction(hash: string) {
    return hash in this._transactions
  }

  async auctionTransaction(
    hash: string,
    tx: TransactionIntent,
    options?: NectarOptions
  ): Promise<{
    hasWinner: boolean
    bundle: TransactionBundle | undefined
    bid?: BigNumberish
  }> {
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
    const userAddress = tx.from || ethers.constants.AddressZero
    const auctionAllocationValue = bid.mul(5).div(100)
    const userAllocationValue = bid.sub(auctionAllocationValue)

    await Payment.create([
      {
        tx: highestBid.bidTx,
        address: userAddress,
        value: userAllocationValue.toString(),
      },
      {
        tx: highestBid.bidTx,
        address: auctionAddress,
        value: auctionAllocationValue.toString(),
      },
    ])

    return {
      hasWinner: true,
      bundle: highestBid.bundle,
      bid: highestBid.bid,
    }
  }

  bidOnTransaction(bidder: string, bundle: TransactionBundle) {
    console.log('Bundle from:', bidder, bundle)
    const auctionAddress = env['AUCTION_ADDRESS']

    let payment = BigNumber.from(0)
    let paymentTx = ''
    let userTxIndex = -1
    for (const [index, item] of bundle.entries()) {
      if ('hash' in item) {
        if (userTxIndex >= 0) {
          console.error('multiple user transactions in bundle')
          return
        } else {
          userTxIndex = index
        }
      }
      if ('signedTransaction' in item) {
        const parsedTx = ethers.utils.parseTransaction(item.signedTransaction)
        if (parsedTx.to && parsedTx.to === auctionAddress && parsedTx.data === '0x') {
          paymentTx = parsedTx.hash || ''
          const txValue = BigNumber.from(parsedTx.value)
          payment = txValue
        }
      }
    }

    const txHash = bundle[userTxIndex] as BundleTransactionHash
    const transaction = this._transactions[txHash.hash]
    console.log('Bid value:', ethers.utils.formatEther(payment))
    reportAddressEvent(
      transaction.tx.from!,
      `Auction: Received ${ethers.utils.formatEther(payment)} ETH bid for tx ${txHash.hash}`
    )

    if (transaction && transaction.bids) {
      transaction.bids[bidder] = {
        bundle: bundle as TransactionBundle,
        bid: payment,
        bidTx: paymentTx,
      }
      // console.log('added bid', bundle, payments)
    }
  }

  private _getHighestBid(hash: string):
    | {
        bidder: string
        bundle: TransactionBundle
        bid: BigNumberish
        bidTx: string
      }
    | undefined {
    const transaction = this._transactions[hash]

    let highestBid = {
      bidder: ethers.constants.AddressZero as string,
      bundle: [] as TransactionBundle,
      bid: BigNumber.from('0'),
      bidTx: '',
    }

    if (transaction) {
      for (const bidder of Object.keys(transaction.bids)) {
        const bid = transaction.bids[bidder]
        const amount = BigNumber.from(bid.bid)

        if (amount.gt(highestBid.bid)) {
          highestBid = { bidder, bundle: bid.bundle, bid: amount, bidTx: bid.bidTx }
        }
      }
    }

    return highestBid.bidder == ethers.constants.AddressZero ? undefined : highestBid
  }
}
