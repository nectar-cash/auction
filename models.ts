import { Model, DataTypes } from './deps.ts'

export class Payment extends Model {
  static table = 'payments'
  static timestamps = true
  static fields = {
    _id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
      allowNull: false
    },
    address: {
      type: DataTypes.STRING,
      allowNull: false
    },
    value: {
      type: DataTypes.STRING, // will store BigNumber
      allowNull: false
    },
    deposited: {
      type: DataTypes.BOOLEAN,
      allowNull: false
    },
  }
  static defaults = {
    deposited: false
  }
}
