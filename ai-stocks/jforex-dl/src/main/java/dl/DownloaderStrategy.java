package dl;

import com.dukascopy.api.Filter;
import com.dukascopy.api.IAccount;
import com.dukascopy.api.IBar;
import com.dukascopy.api.IContext;
import com.dukascopy.api.IHistory;
import com.dukascopy.api.IMessage;
import com.dukascopy.api.IStrategy;
import com.dukascopy.api.Instrument;
import com.dukascopy.api.JFException;
import com.dukascopy.api.OfferSide;
import com.dukascopy.api.Period;

import java.io.File;
import java.io.PrintWriter;
import java.text.DecimalFormat;
import java.text.DecimalFormatSymbols;
import java.text.SimpleDateFormat;
import java.util.Calendar;
import java.util.GregorianCalendar;
import java.util.List;
import java.util.Locale;
import java.util.TimeZone;

/**
 * Exports 5-min BID+ASK OHLCV per instrument by year-chunked IHistory.getBars() calls against the
 * authenticated demo feed. Output CSV schema matches the dukascopy-node pipeline exactly
 * (timestamp,open,high,low,close,volume ; UTC ; volume = indicative CFD volume) so the existing
 * Bun/TS build_outputs.ts ingests it with no changes.
 */
public class DownloaderStrategy implements IStrategy {
    private static final long FIVE_MIN = 5L * 60L * 1000L;
    private final List<Main.Inst> list;
    private final String outRoot;
    private final long toMs;

    private final SimpleDateFormat ts;
    private final DecimalFormat px;

    public DownloaderStrategy(List<Main.Inst> list, String outRoot, long toMs) {
        this.list = list; this.outRoot = outRoot; this.toMs = toMs;
        ts = new SimpleDateFormat("yyyy-MM-dd HH:mm:ss");
        ts.setTimeZone(TimeZone.getTimeZone("UTC"));
        px = new DecimalFormat("0.#####", DecimalFormatSymbols.getInstance(Locale.US));
    }

    public void onStart(IContext context) throws JFException {
        IHistory history = context.getHistory();
        try {
            dumpAvailableUs();
            int idx = 0;
            for (Main.Inst in : list) {
                idx++;
                if (in.instrument == null) { System.out.println("[dl] skip (unresolved) " + in.ticker); continue; }
                System.out.println("[dl] (" + idx + "/" + list.size() + ") " + in.ticker + " " + in.instrument.toString());
                fetchSide(history, in, OfferSide.BID, "bid");
                fetchSide(history, in, OfferSide.ASK, "ask");
            }
            System.out.println("[dl] ALL DONE");
        } catch (Throwable t) {
            System.err.println("[dl] FATAL " + t);
            t.printStackTrace();
        } finally {
            context.stop();
        }
    }

    private void fetchSide(IHistory history, Main.Inst in, OfferSide side, String sideName) {
        long from = parseUtcMidnight(in.fromDate);
        int startYear = yearOf(from), endYear = yearOf(toMs);
        long totalRows = 0;
        for (int y = startYear; y <= endYear; y++) {
            File dir = new File(outRoot, in.ticker);
            dir.mkdirs();
            File f = new File(dir, in.iid + "-m5-" + sideName + "-" + y + ".csv");
            PrintWriter w = null;
            long yrRows = 0;
            for (int m = 0; m < 12; m++) {
                long cFrom = Math.max(from, utcMonthStart(y, m));
                long cTo = Math.min(toMs, utcMonthStart(y, m + 1) - FIVE_MIN);
                cFrom = align(cFrom); cTo = align(cTo);
                if (cFrom >= cTo) continue;
                List<IBar> bars = getBarsRetry(history, in, side, cFrom, cTo);
                if (bars == null || bars.isEmpty()) continue;
                try {
                    if (w == null) { w = new PrintWriter(f, "UTF-8"); w.println("timestamp,open,high,low,close,volume"); }
                    for (IBar b : bars) {
                        w.println(ts.format(b.getTime()) + "," + px.format(b.getOpen()) + "," + px.format(b.getHigh())
                                + "," + px.format(b.getLow()) + "," + px.format(b.getClose()) + "," + px.format(b.getVolume()));
                        yrRows++;
                    }
                    w.flush();
                } catch (Throwable t) { System.err.println("[dl]   write err " + f.getName() + ": " + t); }
            }
            if (w != null) {
                w.close();
                totalRows += yrRows;
                System.out.println("[dl]   " + in.ticker + " " + sideName + " " + y + " rows=" + yrRows);
            }
        }
        System.out.println("[dl]   " + in.ticker + " " + sideName + " TOTAL rows=" + totalRows);
    }

    private List<IBar> getBarsRetry(IHistory history, Main.Inst in, OfferSide side, long cFrom, long cTo) {
        for (int attempt = 1; attempt <= 4; attempt++) {
            try {
                return history.getBars(in.instrument, Period.FIVE_MINS, side, Filter.WEEKENDS, cFrom, cTo);
            } catch (Throwable t) {
                System.err.println("[dl]   " + in.ticker + " " + side + " " + cFrom + " attempt " + attempt + " err: " + t.getMessage());
                try { Thread.sleep(2000L * attempt); } catch (InterruptedException ie) { /* ignore */ }
            }
        }
        return null;
    }

    private void dumpAvailableUs() {
        try {
            File f = new File(outRoot, "_available_us_instruments.txt");
            f.getParentFile().mkdirs();
            PrintWriter w = new PrintWriter(f, "UTF-8");
            for (Instrument i : Instrument.values()) {
                String s = i.toString();
                if (s.contains(".US/") || s.contains(".US-")) w.println(s);
            }
            w.close();
        } catch (Exception e) { /* non-fatal */ }
    }

    private static long parseUtcMidnight(String yyyyMmDd) {
        String[] p = yyyyMmDd.split("-");
        GregorianCalendar c = new GregorianCalendar(TimeZone.getTimeZone("UTC"));
        c.clear();
        c.set(Integer.parseInt(p[0]), Integer.parseInt(p[1]) - 1, Integer.parseInt(p[2]), 0, 0, 0);
        return c.getTimeInMillis();
    }
    private static int yearOf(long ms) {
        GregorianCalendar c = new GregorianCalendar(TimeZone.getTimeZone("UTC")); c.setTimeInMillis(ms);
        return c.get(Calendar.YEAR);
    }
    private static long utcYearStart(int year) {
        GregorianCalendar c = new GregorianCalendar(TimeZone.getTimeZone("UTC")); c.clear();
        c.set(year, 0, 1, 0, 0, 0); return c.getTimeInMillis();
    }
    private static long utcMonthStart(int year, int monthZeroBased) {
        GregorianCalendar c = new GregorianCalendar(TimeZone.getTimeZone("UTC")); c.clear();
        c.set(year, 0, 1, 0, 0, 0);
        c.add(Calendar.MONTH, monthZeroBased); // normalizes month>=12 into following years
        return c.getTimeInMillis();
    }
    private static long align(long ms) { return (ms / FIVE_MIN) * FIVE_MIN; }

    public void onTick(Instrument instrument, com.dukascopy.api.ITick tick) { }
    public void onBar(Instrument instrument, Period period, IBar askBar, IBar bidBar) { }
    public void onMessage(IMessage message) { }
    public void onAccount(IAccount account) { }
    public void onStop() { System.out.println("[dl] onStop"); }
}
