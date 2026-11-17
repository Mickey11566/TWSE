<?php
/**
 * Plugin Name: TWSE 三條件起漲選股
 * Description: 用短代碼 [twse_screener] 把選股畫面放進頁面。內含 TWSE / Yahoo API 代理。
 * Version: 1.0.0
 * Requires PHP: 7.4
 */

if (!defined('ABSPATH')) {
    exit;
}

/**
 * 允許代理的來源與路徑（白名單），避免被當成開放代理亂用。
 */
function twse_screener_sources() {
    return [
        'twse-api' => [
            'host'  => 'https://openapi.twse.com.tw',
            'paths' => '#^/v1/(opendata/t187ap14_L|exchangeReport/(STOCK_DAY_ALL|FMTQIK))(\?[A-Za-z0-9=&_.%-]*)?$#',
        ],
        'twse-data' => [
            'host'  => 'https://www.twse.com.tw',
            'paths' => '#^/rwd/zh/fund/T86(\?[A-Za-z0-9=&_.%-]*)?$#',
        ],
        'yahoo-api' => [
            'host'  => 'https://query1.finance.yahoo.com',
            'paths' => '#^/v8/finance/chart/[0-9A-Z]{4,6}\.TW(\?[A-Za-z0-9=&_.%-]*)?$#',
        ],
    ];
}

/**
 * REST API：/wp-json/twse-screener/v1/proxy?src=twse-api&path=/v1/...
 */
add_action('rest_api_init', function () {
    register_rest_route('twse-screener/v1', '/proxy', [
        'methods'             => 'GET',
        'callback'            => 'twse_screener_proxy',
        'permission_callback' => '__return_true', // 公開資料，不需登入
        'args'                => [
            'src'  => ['required' => true, 'type' => 'string'],
            'path' => ['required' => true, 'type' => 'string'],
        ],
    ]);
});

function twse_screener_proxy(WP_REST_Request $request) {
    $sources = twse_screener_sources();
    $src     = $request->get_param('src');
    $path    = $request->get_param('path');

    if (!isset($sources[$src]) || !preg_match($sources[$src]['paths'], $path)) {
        return new WP_Error('twse_forbidden', '不允許的路徑', ['status' => 403]);
    }

    // 快取 10 分鐘，減少打外部 API 的次數
    $cache_key = 'twse_px_' . md5($src . $path);
    $body      = get_transient($cache_key);

    if ($body === false) {
        $response = wp_remote_get($sources[$src]['host'] . $path, [
            'timeout' => 20,
            'headers' => [
                'User-Agent' => 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept'     => 'application/json',
            ],
        ]);

        if (is_wp_error($response)) {
            return new WP_Error('twse_upstream', $response->get_error_message(), ['status' => 502]);
        }

        $code = wp_remote_retrieve_response_code($response);
        $body = wp_remote_retrieve_body($response);

        if ($code !== 200) {
            return new WP_Error('twse_upstream', '外部 API 回應 ' . $code, ['status' => $code === 404 ? 404 : 502]);
        }
        set_transient($cache_key, $body, 10 * MINUTE_IN_SECONDS);
    }

    $data = json_decode($body, true);
    if ($data === null && json_last_error() !== JSON_ERROR_NONE) {
        return new WP_Error('twse_upstream', '外部 API 回傳的不是 JSON', ['status' => 502]);
    }
    return rest_ensure_response($data);
}

/**
 * 短代碼：[twse_screener height="900"]
 * 用 iframe 嵌入，畫面樣式不會和佈景主題互相干擾。
 */
add_shortcode('twse_screener', function ($atts) {
    $atts = shortcode_atts(['height' => 900], $atts, 'twse_screener');

    $index = plugin_dir_path(__FILE__) . 'app/index.html';
    if (!file_exists($index)) {
        return '<p>TWSE 選股：找不到 app/index.html，請重新上傳完整外掛。</p>';
    }

    $src = add_query_arg(
        ['api' => rawurlencode(rest_url('twse-screener/v1/proxy')), 'v' => filemtime($index)],
        plugins_url('app/index.html', __FILE__)
    );
    $id = 'twse-screener-' . wp_unique_id();

    ob_start();
    ?>
    <iframe id="<?php echo esc_attr($id); ?>"
            src="<?php echo esc_url($src); ?>"
            style="width:100%;border:0;display:block;height:<?php echo (int) $atts['height']; ?>px"
            loading="lazy"
            title="TWSE 三條件起漲選股"></iframe>
    <script>
    (function () {
      var frame = document.getElementById(<?php echo wp_json_encode($id); ?>);
      window.addEventListener('message', function (e) {
        if (e.origin !== location.origin || e.source !== frame.contentWindow) return;
        if (e.data && e.data.type === 'twse-screener-height' && e.data.height > 0) {
          frame.style.height = e.data.height + 'px';
        }
      });
    })();
    </script>
    <?php
    return ob_get_clean();
});
