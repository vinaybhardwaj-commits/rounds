// ============================================
// /api/billing/roomcalc
//
// POST — Quick room rent eligibility calculator
// Returns eligibility, proportional deduction risk,
// and recommendation. Used by /roomcalc slash command.
// ============================================

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { ROOM_RENT_ELIGIBILITY_PCT } from '@/types';

// Hospital room rates (₹/day) — can be moved to config later
const ROOM_RATES: Record<string, number> = {
  general: 2000,
  semi_private: 6000,
  private: 8000,
  suite: 12000,
  icu: 15000,
  nicu: 18000,
};

const ROOM_LABELS: Record<string, string> = {
  general: 'General Ward',
  semi_private: 'Semi-Private',
  private: 'Private',
  suite: 'Suite',
  icu: 'ICU',
  nicu: 'NICU',
};

export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { sumInsured, roomCategory, customRoomRate } = body as {
      sumInsured: number;
      roomCategory: string;
      customRoomRate?: number;
    };

    if (!sumInsured || sumInsured <= 0) {
      return NextResponse.json(
        { success: false, error: 'sumInsured is required and must be positive' },
        { status: 400 }
      );
    }
    if (!roomCategory || !ROOM_RATES[roomCategory]) {
      return NextResponse.json(
        { success: false, error: `Invalid roomCategory. Valid: ${Object.keys(ROOM_RATES).join(', ')}` },
        { status: 400 }
      );
    }

    const isIcu = roomCategory === 'icu' || roomCategory === 'nicu';
    const eligibilityPct = isIcu ? ROOM_RENT_ELIGIBILITY_PCT.icu : ROOM_RENT_ELIGIBILITY_PCT.standard;
    const eligibilityPerDay = Math.round(sumInsured * eligibilityPct);
    const actualRate = customRoomRate || ROOM_RATES[roomCategory];

    let proportionalDeductionPct = 0;
    let extraCostOnFourLakhBill = 0;
    let recommendation: string | null = null;

    if (actualRate > eligibilityPerDay) {
      proportionalDeductionPct = Math.round(((actualRate - eligibilityPerDay) / actualRate) * 10000) / 100;
      // Calculate impact on a sample ₹4L bill
      extraCostOnFourLakhBill = Math.round(400000 * proportionalDeductionPct / 100);

      // Find the highest room that fits within eligibility
      const affordableRooms = Object.entries(ROOM_RATES)
        .filter(([, rate]) => rate <= eligibilityPerDay)
        .sort(([, a], [, b]) => b - a);

      if (affordableRooms.length > 0) {
        const [bestRoom, bestRate] = affordableRooms[0];
        recommendation = `${ROOM_LABELS[bestRoom]} (₹${bestRate.toLocaleString('en-IN')}/day) eliminates proportional deduction`;
      }
    }

    // Build formatted message for system message posting
    const roomLabel = ROOM_LABELS[roomCategory] || roomCategory;
    let message = `🏠 **Room Rent Check:** ₹${sumInsured.toLocaleString('en-IN')} sum insured → ₹${eligibilityPerDay.toLocaleString('en-IN')}/day eligibility (${eligibilityPct * 100}%)`;
    message += `\n${roomLabel}: ₹${actualRate.toLocaleString('en-IN')}/day`;

    if (proportionalDeductionPct > 0) {
      message += ` → **${proportionalDeductionPct}% proportional deduction risk**`;
      message += `\nOn a ₹4L bill, patient pays extra ~₹${extraCostOnFourLakhBill.toLocaleString('en-IN')}`;
      if (recommendation) message += `\n💡 ${recommendation}`;
    } else {
      message += ` → ✅ No proportional deduction risk`;
    }

    return NextResponse.json({
      success: true,
      data: {
        sumInsured,
        roomCategory,
        roomLabel,
        actualRate,
        eligibilityPct,
        eligibilityPerDay,
        proportionalDeductionPct,
        extraCostOnFourLakhBill,
        recommendation,
        message,
      },
    });
  } catch (error) {
    console.error('POST /api/billing/roomcalc error:', error);
    return NextResponse.json(
      { success: false, error: 'Calculator error' },
      { status: 500 }
    );
  }
}
