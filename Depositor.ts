import { BigNumber, ethers } from './deps.ts'
import { config } from './deps.ts'

import { Payment } from './models.ts'
import { NectarVault__factory } from './typechain-types/factories/NectarVault__factory.ts'
import rpc from './RPCProxy.ts'
import reportAddressEvent from './EventReporter.ts'

const env = config()
const VAULT_ADDRESS = '0x328E07B5b09a8c9e01A849C8d8f246d56ed3ec75'

export default async function deposit() {
  const wallet = new ethers.Wallet(env['AUCTION_PRIVATE_KEY'], rpc)
  const nectarVault = NectarVault__factory.connect(VAULT_ADDRESS, wallet)

  const undepositedTxs = (await Payment.where({ deposited: false, included: true }).get()) as Payment[]
  // console.log(undepositedTxs)

  const accountedIds: number[] = []
  const deposits: { [key: string]: BigNumber } = {}
  for (const undepositedTx of undepositedTxs) {
    const targetAddress = undepositedTx.address as string
    if (targetAddress in deposits) {
      deposits[targetAddress].add(BigNumber.from(undepositedTx.value))
    } else {
      deposits[targetAddress] = BigNumber.from(undepositedTx.value)
    }
    accountedIds.push(undepositedTx._id as number)
  }

  if (accountedIds.length === 0) {
    return true
  }

  console.log(deposits)

  const depositTxAddresses = Object.keys(deposits)
  const depositTxAmounts: BigNumber[] = []
  let totalDepositValue = BigNumber.from(0)
  for (const depositTxAddress of depositTxAddresses) {
    const depositAmount = deposits[depositTxAddress]
    totalDepositValue = totalDepositValue.add(depositAmount)
    depositTxAmounts.push(depositAmount)
  }

  console.log(depositTxAddresses)
  console.log(totalDepositValue.toString())

  for (let index = 0; index < depositTxAddresses.length; index++) {
    const depositTxAddress = depositTxAddresses[index]
    console.log('remove me', depositTxAddress, env['AUCTION_ADDRESS'])
    if (depositTxAddress === env['AUCTION_ADDRESS']) {
      continue
    }
    reportAddressEvent(
      depositTxAddress,
      `Auction: Nectar Vault deposit of ${ethers.utils.formatEther(depositTxAmounts[index])} ETH created`
    )
  }

  const depositTx = await nectarVault.deposit(depositTxAddresses, depositTxAmounts, {
    value: totalDepositValue,
    gasLimit: 150000,
  })
  console.log('depositTx', depositTx)
  const depositReceipt = await depositTx.wait()
  console.log('depositReceipt', depositReceipt)

  if (depositReceipt.blockNumber > 0) {
    for (const accountedId of accountedIds) {
      await Payment.where({ id: accountedId }).update({ deposited: true })
    }
  }

  for (let index = 0; index < depositTxAddresses.length; index++) {
    const depositTxAddress = depositTxAddresses[index]
    if (depositTxAddress === env['AUCTION_ADDRESS']) {
      continue
    }
    reportAddressEvent(
      depositTxAddress,
      `Auction: Nectar Vault deposit (tx ${depositReceipt.transactionHash}) of ${ethers.utils.formatEther(
        depositTxAmounts[index]
      )} ETH included in the block ${depositReceipt.blockNumber}`
    )
  }

  const balance = await nectarVault.balanceOf(env['AUCTION_ADDRESS'])
  console.log(`Our balance is: ${ethers.utils.formatEther(balance)}`)

  return true
}
