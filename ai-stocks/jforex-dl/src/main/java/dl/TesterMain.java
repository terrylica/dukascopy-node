package dl;

import com.dukascopy.api.Instrument;
import com.dukascopy.api.LoadingProgressListener;
import com.dukascopy.api.system.ISystemListener;
import com.dukascopy.api.system.ITesterClient;
import com.dukascopy.api.system.TesterFactory;

import java.io.BufferedReader;
import java.io.FileReader;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

/**
 * Historical-data downloader via ITesterClient (the SDK's backtest/historical client). Unlike the
 * live IClient path, the tester is NOT "automated trading", so US stock CFDs can be subscribed and
 * their bars read. A minimal 1-day sim interval keeps the tester's own tick-load tiny; the real
 * pull happens in DownloaderStrategy.onStart via IHistory.getBars over each instrument's full range.
 * Args: <instruments.tsv> <outRoot> [tickerFilter]
 */
public class TesterMain {
    static final String DEMO_JNLP = System.getenv("JFOREX_JNLP") != null
        ? System.getenv("JFOREX_JNLP") : "http://platform.dukascopy.com/demo/jforex.jnlp";

    public static void main(String[] args) throws Exception {
        if (args.length < 2) { System.err.println("usage: TesterMain <instruments.tsv> <outRoot> [tickerFilter]"); System.exit(2); }
        String tsv = args[0], outRoot = args[1];
        String only = args.length >= 3 && !args[2].isEmpty() ? args[2].toUpperCase() : null;
        String user = System.getenv("JFOREX_USER"), pass = System.getenv("JFOREX_PASS");
        if (user == null || pass == null) { System.err.println("set JFOREX_USER / JFOREX_PASS"); System.exit(2); }

        List<Main.Inst> list = new ArrayList<Main.Inst>();
        BufferedReader br = new BufferedReader(new FileReader(tsv));
        String line;
        while ((line = br.readLine()) != null) {
            if (line.trim().isEmpty()) continue;
            String[] p = line.split("\t");
            if (p.length < 4) continue;
            if (only != null && !p[0].toUpperCase().equals(only)) continue;
            list.add(new Main.Inst(p[0], p[1], p[2], p[3]));
        }
        br.close();
        System.out.println("[tester] work-list: " + list.size() + " instrument(s)" + (only != null ? " (filter=" + only + ")" : ""));

        ITesterClient client = TesterFactory.getDefaultInstance();
        final CountDownLatch done = new CountDownLatch(1);
        client.setSystemListener(new ISystemListener() {
            public void onStart(long processId) { System.out.println("[sys] strategy started id=" + processId); }
            public void onStop(long processId) { System.out.println("[sys] strategy stopped id=" + processId); done.countDown(); }
            public void onConnect() { System.out.println("[sys] connected"); }
            public void onDisconnect() { System.out.println("[sys] disconnected"); }
        });

        System.out.println("[tester] connecting to DEMO server (historical/tester client)...");
        client.connect(DEMO_JNLP, user, pass);
        for (int i = 0; i < 60 && !client.isConnected(); i++) Thread.sleep(1000);
        if (!client.isConnected()) { System.err.println("[tester] FAILED to connect"); System.exit(1); }
        System.out.println("[tester] connected=" + client.isConnected());

        // resolve + subscribe (tester allows US stocks — historical, not live trading)
        Set<Instrument> subscribe = new HashSet<Instrument>();
        for (Main.Inst in : list) {
            Instrument r = Main.resolve(in.title);
            if (r == null) { System.out.println("[tester] UNRESOLVED " + in.ticker + " (" + in.title + ")"); continue; }
            in.instrument = r;
            subscribe.add(r);
        }
        System.out.println("[tester] subscribing " + subscribe.size() + " instrument(s)...");
        client.setSubscribedInstruments(subscribe);
        for (int i = 0; i < 60; i++) {
            if (client.getSubscribedInstruments().containsAll(subscribe)) break;
            Thread.sleep(1000);
        }
        System.out.println("[tester] subscribed=" + client.getSubscribedInstruments().size());

        long toMs = System.currentTimeMillis();
        // minimal sim window so the tester's own tick-load is trivial; real pull is in onStart.getBars
        long simFrom = toMs - 24L * 60L * 60L * 1000L;
        client.setInitialDeposit(Instrument.EURUSD.getSecondaryJFCurrency(), 1000000);
        client.setDataInterval(ITesterClient.DataLoadingMethod.ALL_TICKS, simFrom, toMs);

        DownloaderStrategy strat = new DownloaderStrategy(list, outRoot, toMs);
        System.out.println("[tester] starting strategy (downloader)...");
        client.startStrategy(strat, new LoadingProgressListener() {
            public void dataLoaded(long start, long end, long currentPosition, String information) { }
            public void loadingFinished(boolean allDataLoaded, long start, long end, long currentPosition) { }
            public boolean stopJob() { return false; }
        });

        boolean ok = done.await(24, TimeUnit.HOURS);
        System.out.println("[tester] done=" + ok + " — disconnecting");
        try { client.disconnect(); } catch (Exception e) { /* ignore */ }
        System.exit(0);
    }
}
