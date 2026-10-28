-- The operator console now opens in the Light (white and gold) look by
-- default. Libraries still on the old Dark default switch to Light once; the
-- button at the top of the window (or Settings → General) switches back.
UPDATE app_settings SET value = '"light"' WHERE key = 'general.uiTheme' AND value = '"dark"';
