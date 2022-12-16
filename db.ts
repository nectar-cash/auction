import { Database, PostgresConnector } from './deps.ts'
import { Payment } from './models.ts'

const connector = new PostgresConnector({
  database: 'auction',
  host: 'auctiondb',
  username: 'auction',
  password: 'auction',
})

const db = new Database(connector, { debug: true })

db.link([Payment])

export default db
