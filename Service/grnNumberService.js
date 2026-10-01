import WarehouseReceiving from '../Model/wareHouse.js';
import { Sequence } from '../Model/workflow.js';

export async function nextGrnNumber() {
  // Include existing manually numbered receipts when starting or restoring a counter.
  const [existing] = await WarehouseReceiving.aggregate([
    { $match: { grnNumber: { $regex: '^GRN-[0-9]+$' } } },
    { $group: { _id: null, maximum: { $max: { $convert: { input: { $substrBytes: ['$grnNumber', 4, -1] }, to: 'double', onError: 0, onNull: 0 } } } } },
  ]);
  const floor = existing?.maximum || 0;
  try {
    await Sequence.updateOne({ _id: 'GRN-' }, { $max: { value: floor } }, { upsert: true, setDefaultsOnInsert: false });
  } catch (error) {
    // Another first receipt may initialize the counter concurrently.
    if (error.code !== 11000) throw error;
    await Sequence.updateOne({ _id: 'GRN-' }, { $max: { value: floor } });
  }
  const sequence = await Sequence.findOneAndUpdate({ _id: 'GRN-' }, { $inc: { value: 1 } }, { new: true });
  return 'GRN-' + String(sequence.value).padStart(3, '0');
}
