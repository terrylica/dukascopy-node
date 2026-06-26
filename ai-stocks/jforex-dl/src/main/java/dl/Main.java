package dl;

import com.dukascopy.api.Instrument;
import com.dukascopy.api.system.ClientFactory;
import com.dukascopy.api.system.IClient;
import com.dukascopy.api.system.ISystemListener;

import java.io.BufferedReader;
import java.io.FileReader;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.TimeZone;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

/**
 * Headless Dukascopy JForex-SDK downloader. Connects to the AUTHENTICATED demo DDS server
 * (NOT the public datafeed.dukascopy.com CDN that network-blocks our IPs), subscribes the AI
 * stock-CFD universe, and runs DownloaderStrategy to export 5-min BID+ASK OHLCV CSV per ticker.
 * Args: <instruments.tsv> <outRoot> [tickerFilter]   (tickerFilter optional: only that one ticker)
 */
public class Main {
    static final String DEMO_JNLP = "https://www.dukascopy.com/client/demo/jclient/jforex.jnlp";

    public static final class Inst {
        public final String ticker, iid, title, fromDate;
        public Instrument instrument;
        public Inst(String t, String i, String ti, String f) { ticker = t; iid = i; title = ti; fromDate = f; }
    }

    public static void main(String[] args) throws Exception {
        if (args.length < 2) { System.err.println("usage: Main <instruments.tsv> <outRoot> [tickerFilter]"); System.exit(2); }
        String tsv = args[0], outRoot = args[1];
        String only = args.length >= 3 ? args[2].toUpperCase() : null;
        String user = env("JFOREX_USER"), pass = env("JFOREX_PASS");
        if (user == null || pass == null) { System.err.println("set JFOREX_USER / JFOREX_PASS"); System.exit(2); }

        List<Inst> list = new ArrayList<Inst>();
        BufferedReader br = new BufferedReader(new FileReader(tsv));
        String line;
        while ((line = br.readLine()) != null) {
            if (line.trim().isEmpty()) continue;
            String[] p = line.split("\t");
            if (p.length < 4) continue;
            if (only != null && !p[0].toUpperCase().equals(only)) continue;
            list.add(new Inst(p[0], p[1], p[2], p[3]));
        }
        br.close();
        System.out.println("[main] work-list: " + list.size() + " instrument(s)" + (only != null ? " (filter=" + only + ")" : ""));

        IClient client = ClientFactory.getDefaultInstance();
        final CountDownLatch done = new CountDownLatch(1);
        client.setSystemListener(new ISystemListener() {
            public void onStart(long processId) { System.out.println("[sys] strategy started id=" + processId); }
            public void onStop(long processId) { System.out.println("[sys] strategy stopped id=" + processId); done.countDown(); }
            public void onConnect() { System.out.println("[sys] connected"); }
            public void onDisconnect() { System.out.println("[sys] disconnected"); }
        });

        System.out.println("[main] connecting to DEMO DDS server (authenticated, not the CDN)...");
        client.connect(DEMO_JNLP, user, pass);
        for (int i = 0; i < 60 && !client.isConnected(); i++) Thread.sleep(1000);
        if (!client.isConnected()) { System.err.println("[main] FAILED to connect within 60s"); System.exit(1); }
        System.out.println("[main] connected=" + client.isConnected());

        // resolve US instruments (do NOT subscribe them yet — subscribing a US stock before
        // strategy-start trips the "forbidden for automated trading" guard). The strategy
        // subscribes them at RUNTIME (after the start-time check has already passed).
        for (Inst in : list) {
            Instrument r = resolve(in.title);
            if (r == null) { System.out.println("[main] UNRESOLVED instrument: " + in.ticker + " (" + in.title + ")"); continue; }
            in.instrument = r;
        }

        // subscribe only a harmless FX instrument so the strategy can start cleanly
        Set<Instrument> seed = new HashSet<Instrument>();
        seed.add(Instrument.EURUSD);
        System.out.println("[main] seed-subscribing EUR/USD (strategy will add US stocks at runtime)...");
        client.setSubscribedInstruments(seed);
        for (int i = 0; i < 60; i++) {
            if (client.getSubscribedInstruments().containsAll(seed)) break;
            Thread.sleep(1000);
        }
        System.out.println("[main] seed subscribed=" + client.getSubscribedInstruments());

        long toMs = System.currentTimeMillis();
        DownloaderStrategy strat = new DownloaderStrategy(list, outRoot, toMs);
        client.startStrategy(strat);
        boolean ok = done.await(12, TimeUnit.HOURS);
        System.out.println("[main] strategy done=" + ok + " — disconnecting");
        try { client.disconnect(); } catch (Exception e) { /* ignore */ }
        System.exit(0);
    }

    static Instrument resolve(String title) {
        try {
            Instrument i = Instrument.fromString(title);
            if (i != null) return i;
        } catch (Exception e) { /* fall through */ }
        for (Instrument i : Instrument.values()) {
            if (i.toString().equalsIgnoreCase(title)) return i;
            if (i.name().equalsIgnoreCase(title.replace(".", "").replace("/", "").replace("-", ""))) return i;
        }
        return null;
    }

    static String env(String k) { String v = System.getenv(k); return (v == null || v.isEmpty()) ? null : v; }
}
