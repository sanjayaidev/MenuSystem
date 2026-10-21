/* Order status names + order/tracking texts, shared by menu-page.html and track.html.
   Statuses (same list as routes/admin.js VALID_STATUSES):
     pickup:   pending > confirmed > preparing > ready > completed
     delivery: pending > confirmed > preparing > ready > out_for_delivery > completed
     cancelled can happen at any point.
   The same status reads differently per order type ("ready" = ready for pickup / ready for delivery). */
(function(){
  var LABELS = {
    en:{ pending:'Order received', confirmed:'Confirmed', preparing:'Being prepared', ready_pickup:'Ready for pickup', ready_delivery:'Ready for delivery',
         out_for_delivery:'Out for delivery', completed_pickup:'Picked up', completed_delivery:'Delivered', cancelled:'Cancelled' },
    ar:{ pending:'تم استلام الطلب', confirmed:'تم التأكيد', preparing:'قيد التحضير', ready_pickup:'جاهز للاستلام', ready_delivery:'جاهز للتوصيل',
         out_for_delivery:'في الطريق إليك', completed_pickup:'تم الاستلام', completed_delivery:'تم التوصيل', cancelled:'ملغي' },
    ur:{ pending:'آرڈر موصول ہو گیا', confirmed:'تصدیق ہو گئی', preparing:'تیاری جاری ہے', ready_pickup:'وصولی کے لیے تیار', ready_delivery:'ڈیلیوری کے لیے تیار',
         out_for_delivery:'راستے میں ہے', completed_pickup:'وصول کر لیا گیا', completed_delivery:'ڈیلیور ہو گیا', cancelled:'منسوخ' },
    zh:{ pending:'已收到订单', confirmed:'已确认', preparing:'制作中', ready_pickup:'可取餐', ready_delivery:'待配送',
         out_for_delivery:'配送中', completed_pickup:'已取餐', completed_delivery:'已送达', cancelled:'已取消' }
  };

  var TEXT = {
    en:{ orderPlaced:'Order placed', orderNumber:'Your order number', keepNumber:'Keep this number. You can follow your order with it at any time.',
         trackOrder:'Track my order', sendWhatsapp:'Send order on WhatsApp', close:'Close', track:'Track',
         trackTitle:'Track your order', orderNo:'Order number', orderNoPh:'RH-260928-0042', phone:'Phone number used on the order', phonePh:'+__ _________',
         find:'Find my order', yourOrders:'Your orders on this device', noneYet:'No orders saved on this device yet. Enter an order number and phone number to find one.',
         lookup:'Find another order', items:'Items', delivery:'Delivery', total:'Total', placedOn:'Placed', updated:'Updated', autoRefresh:'This page updates by itself.',
         notFound:'We could not find that order. Check the order number and phone number.', loadFail:'Could not load the order. Please try again.', loading:'Loading…',
         back:'Back to the menu', signedIn:'Your account orders', cancelledNote:'This order was cancelled. Contact the restaurant if you have questions.' },
    ar:{ orderPlaced:'تم إرسال الطلب', orderNumber:'رقم طلبك', keepNumber:'احتفظ بهذا الرقم. يمكنك متابعة طلبك به في أي وقت.',
         trackOrder:'تتبّع طلبي', sendWhatsapp:'أرسل الطلب عبر واتساب', close:'إغلاق', track:'تتبّع',
         trackTitle:'تتبّع طلبك', orderNo:'رقم الطلب', orderNoPh:'RH-260928-0042', phone:'رقم الهاتف المستخدم في الطلب', phonePh:'+__ _________',
         find:'ابحث عن طلبي', yourOrders:'طلباتك على هذا الجهاز', noneYet:'لا توجد طلبات محفوظة على هذا الجهاز. أدخل رقم الطلب ورقم الهاتف للبحث.',
         lookup:'ابحث عن طلب آخر', items:'الأصناف', delivery:'التوصيل', total:'الإجمالي', placedOn:'وقت الطلب', updated:'آخر تحديث', autoRefresh:'تتحدّث هذه الصفحة تلقائيًا.',
         notFound:'لم نجد هذا الطلب. تحقق من رقم الطلب ورقم الهاتف.', loadFail:'تعذّر تحميل الطلب. حاول مرة أخرى.', loading:'جارٍ التحميل…',
         back:'العودة إلى القائمة', signedIn:'طلبات حسابك', cancelledNote:'تم إلغاء هذا الطلب. تواصل مع المطعم إذا كانت لديك أسئلة.' },
    ur:{ orderPlaced:'آرڈر بھیج دیا گیا', orderNumber:'آپ کا آرڈر نمبر', keepNumber:'یہ نمبر محفوظ رکھیں۔ اس سے آپ کسی بھی وقت اپنا آرڈر دیکھ سکتے ہیں۔',
         trackOrder:'میرا آرڈر ٹریک کریں', sendWhatsapp:'آرڈر واٹس ایپ پر بھیجیں', close:'بند کریں', track:'ٹریک',
         trackTitle:'اپنا آرڈر ٹریک کریں', orderNo:'آرڈر نمبر', orderNoPh:'RH-260928-0042', phone:'آرڈر میں استعمال ہونے والا فون نمبر', phonePh:'+__ _________',
         find:'میرا آرڈر تلاش کریں', yourOrders:'اس ڈیوائس پر آپ کے آرڈرز', noneYet:'اس ڈیوائس پر کوئی آرڈر محفوظ نہیں۔ تلاش کے لیے آرڈر نمبر اور فون نمبر درج کریں۔',
         lookup:'دوسرا آرڈر تلاش کریں', items:'اشیاء', delivery:'ڈیلیوری', total:'کل', placedOn:'آرڈر کا وقت', updated:'آخری اپ ڈیٹ', autoRefresh:'یہ صفحہ خود بخود اپ ڈیٹ ہوتا ہے۔',
         notFound:'یہ آرڈر نہیں ملا۔ آرڈر نمبر اور فون نمبر چیک کریں۔', loadFail:'آرڈر لوڈ نہیں ہو سکا۔ دوبارہ کوشش کریں۔', loading:'لوڈ ہو رہا ہے…',
         back:'مینو پر واپس', signedIn:'آپ کے اکاؤنٹ کے آرڈرز', cancelledNote:'یہ آرڈر منسوخ کر دیا گیا۔ سوال ہو تو ریستوران سے رابطہ کریں۔' },
    zh:{ orderPlaced:'订单已提交', orderNumber:'您的订单号', keepNumber:'请保存此订单号，您可以随时用它查看订单进度。',
         trackOrder:'查看订单进度', sendWhatsapp:'通过 WhatsApp 发送订单', close:'关闭', track:'查看',
         trackTitle:'查看订单进度', orderNo:'订单号', orderNoPh:'RH-260928-0042', phone:'下单时使用的手机号码', phonePh:'+__ _________',
         find:'查找订单', yourOrders:'此设备上的订单', noneYet:'此设备上还没有保存的订单。请输入订单号和手机号码查找。',
         lookup:'查找其他订单', items:'商品', delivery:'配送费', total:'合计', placedOn:'下单时间', updated:'更新时间', autoRefresh:'此页面会自动更新。',
         notFound:'找不到该订单。请检查订单号和手机号码。', loadFail:'无法加载订单，请重试。', loading:'加载中…',
         back:'返回菜单', signedIn:'您账户的订单', cancelledNote:'此订单已取消。如有疑问请联系餐厅。' }
  };

  var FLOW = {
    pickup:   ['pending', 'confirmed', 'preparing', 'ready', 'completed'],
    delivery: ['pending', 'confirmed', 'preparing', 'ready', 'out_for_delivery', 'completed']
  };
  function kind(type){ return type === 'delivery' ? 'delivery' : 'pickup'; }

  window.RHOrder = {
    flow: function(type){ return FLOW[kind(type)].slice(); },
    label: function(status, type, lang){
      var key = (status === 'ready' || status === 'completed') ? status + '_' + kind(type) : status;
      return (LABELS[lang] || LABELS.en)[key] || LABELS.en[key] || String(status || '');
    },
    t: function(key, lang){ return (TEXT[lang] || TEXT.en)[key] || TEXT.en[key] || key; },

    /* orders placed on this device (guests have no account, so the token is kept here) */
    KEY: 'redhouse_orders',
    saved: function(){
      try{ var a = JSON.parse(localStorage.getItem('redhouse_orders') || '[]'); return Array.isArray(a) ? a : []; }catch(e){ return []; }
    },
    remember: function(number, token){
      if(!number || !token) return;
      try{
        var list = this.saved().filter(function(o){ return o.n !== number; });
        list.unshift({ n: number, t: token, at: Date.now() });
        localStorage.setItem('redhouse_orders', JSON.stringify(list.slice(0, 20)));
      }catch(e){ /* storage unavailable, ignore */ }
    },
    trackUrl: function(number, token){
      return window.location.origin + '/track?o=' + encodeURIComponent(number) + (token ? '&t=' + encodeURIComponent(token) : '');
    }
  };
})();
