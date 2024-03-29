import { Application, ethers, Router } from './deps.ts'
import { config } from './deps.ts'

import {
  PayloadAny,
  PayloadAuctionBidRecipient,
  PayloadAuctionResult,
  PayloadRPCNewAuction,
  PayloadSearcherBid,
  TransactionBundle,
} from './deps.ts'
import {
  METHOD_AUCTION_BID_RECIPIENT,
  METHOD_AUCTION_RESULT,
  METHOD_RPC_NEW_AUCTION,
  METHOD_SEARCHER_BID,
} from './deps.ts'
import db from './db.ts'

const env = { ...config(), ...Deno.env.toObject() }
import AuctionController from './AuctionController.ts'
import deposit from './Depositor.ts'
import confirmTxs from './Confirmer.ts'
import reportAddressEvent from './EventReporter.ts'

const app = new Application()
const port = parseInt(env['PORT'] || '8000')

const router = new Router()

const registeredRPCs: { [address: string]: WebSocket } = {}
const registeredSearchers: { [address: string]: WebSocket } = {}

const auctionController = new AuctionController()

let doneWithDeposit = true
const depositIfReady = async () => {
  if (doneWithDeposit) {
    doneWithDeposit = false
    const status = await deposit()
    doneWithDeposit = status
  }
}

setInterval(depositIfReady, 60 * 1000) // every minute
setInterval(confirmTxs, 12 * 1000) // every block

router.get('/health', (ctx) => {
  ctx.response.body = 'ok'
})

router.get('/rpc', (ctx) => {
  if (!ctx.isUpgradable) {
    ctx.throw(501)
  }

  const address = ctx.request.url.searchParams.get('address')
  if (address) {
    const ws = ctx.upgrade()
    registeredRPCs[address] = ws

    ws.onopen = () => {
      console.log('RPC connected:', address)
    }
    ws.onmessage = async (m) => {
      try {
        const body = JSON.parse(m.data) as PayloadAny
        const { method, data } = body
        // console.log('\nRPC message:', address, method)
        if (method === METHOD_RPC_NEW_AUCTION) {
          const { hash, tx, options } = data as PayloadRPCNewAuction['data']
          if (auctionController.hasTransaction(hash)) {
            console.log('Auction for tx', hash, 'already ongoing')
            return
          }
          reportAddressEvent(tx.from!, `Auction: Starting auction for tx ${hash}`)
          console.log('Starting auction for tx', hash, 'with options', options)

          const searcherPayload: PayloadRPCNewAuction = {
            method: METHOD_RPC_NEW_AUCTION,
            data: {
              hash,
              tx,
              options,
            },
          }

          for (const searcher of Object.keys(registeredSearchers)) {
            registeredSearchers[searcher].send(JSON.stringify(searcherPayload))
          }

          const { hasWinner, bundle, bid } = await auctionController.auctionTransaction(hash, tx, options)
          if (hasWinner) {
            reportAddressEvent(
              tx.from!,
              `Auction: Auction concluded for tx ${hash} with winning bid of ${ethers.utils.formatEther(bid!)}`
            )
          } else {
            reportAddressEvent(tx.from!, `Auction: Auction concluded for tx ${hash} without any bids`)
          }
          const auctionResultPayload: PayloadAuctionResult = {
            method: METHOD_AUCTION_RESULT,
            data: hasWinner
              ? {
                  hash,
                  hasWinner,
                  bundle: bundle as TransactionBundle,
                }
              : {
                  hash,
                  hasWinner,
                  bundle: undefined,
                },
          }

          ws.send(JSON.stringify(auctionResultPayload))
          auctionController.removeTransaction(hash)
        }
      } catch (e) {
        console.error('fail during rpc message', e, m.data)
      }
      ws.send(m.data as string)
    }
    ws.onclose = () => console.log('RPC disconnected:', address)
  }
})

router.get('/searcher', (ctx) => {
  if (!ctx.isUpgradable) {
    ctx.throw(501)
  }

  const address = ctx.request.url.searchParams.get('address')
  // console.log('searcher', address)
  if (address) {
    const ws = ctx.upgrade()
    registeredSearchers[address] = ws

    ws.onopen = () => {
      console.log('Connected to searcher', address)
      const searcherBidRecipientPayload: PayloadAuctionBidRecipient = {
        method: METHOD_AUCTION_BID_RECIPIENT,
        data: {
          address: env['AUCTION_ADDRESS'] as string,
        },
      }
      ws.send(JSON.stringify(searcherBidRecipientPayload))
    }

    ws.onmessage = (m) => {
      // console.log('Got message from searcher: ', address, m.data)
      try {
        const body: PayloadAny = JSON.parse(m.data)
        const { method, data } = body
        // console.log('RPC message:', address, method)
        if (method === METHOD_SEARCHER_BID) {
          const { bundle } = data as PayloadSearcherBid['data']
          console.log('\nReceived a bid from', address, 'with', bundle.length, 'items')
          auctionController.bidOnTransaction(address, bundle)
        }
      } catch (e) {
        console.error('cannot parse message, with error:', e, m.data)
      }
    }
    ws.onclose = () => console.log('Disconncted from searcher', address)
  }
})

app.use(router.routes())
app.use(router.allowedMethods())

await db.sync()

console.log(`Auction House is running at http://localhost:${port}`)
await app.listen({ port: port })
