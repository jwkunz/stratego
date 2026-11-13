package com.stratego.game;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;

/**
 * Keeps the app's process alive and visible (a notification with a Stop button) while this phone hosts a game, so
 * Android does not quietly kill the game for everyone. The game itself runs in the app's WebView; this holds no logic.
 */
public class HostService extends Service {
    static final String ACTION_STOP = "com.stratego.game.STOP_HOSTING";
    private static final String CHANNEL = "hosting";
    private static final int NOTIFICATION_ID = 1;

    /** Set by the bridge: what "Stop" in the notification does. */
    static volatile Runnable onStopRequested;

    static void start(Context c, String addressText) {
        Intent i = new Intent(c, HostService.class).putExtra("address", addressText);
        c.startForegroundService(i);
    }

    static void stop(Context c) {
        c.stopService(new Intent(c, HostService.class));
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && ACTION_STOP.equals(intent.getAction())) {
            Runnable r = onStopRequested;
            if (r != null) r.run();
            stopSelf();
            return START_NOT_STICKY;
        }
        NotificationManager nm = getSystemService(NotificationManager.class);
        nm.createNotificationChannel(new NotificationChannel(CHANNEL, "Hosting a game", NotificationManager.IMPORTANCE_LOW));
        String address = intent != null ? intent.getStringExtra("address") : null;
        PendingIntent open = PendingIntent.getActivity(this, 0, new Intent(this, MainActivity.class)
                .addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_REORDER_TO_FRONT), PendingIntent.FLAG_IMMUTABLE);
        PendingIntent stop = PendingIntent.getService(this, 1, new Intent(this, HostService.class).setAction(ACTION_STOP), PendingIntent.FLAG_IMMUTABLE);
        Notification n = new Notification.Builder(this, CHANNEL)
                .setSmallIcon(R.drawable.ic_notify)
                .setContentTitle("Hosting a Stratego game")
                .setContentText(address == null || address.isEmpty() ? "Other devices can join over Wi-Fi" : "Others join at " + address)
                .setContentIntent(open)
                .addAction(new Notification.Action.Builder(null, "Stop hosting", stop).build())
                .setOngoing(true)
                .build();
        if (Build.VERSION.SDK_INT >= 34) startForeground(NOTIFICATION_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE);
        else startForeground(NOTIFICATION_ID, n);
        return START_NOT_STICKY;
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
