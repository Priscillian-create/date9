// Service Worker Registration
if ('serviceWorker' in navigator && !window.location.hostname.includes('stackblitz')) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('./service-worker.js')
            .then(registration => console.log('ServiceWorker registered:', registration.scope))
            .catch(err => console.log('ServiceWorker registration failed:', err));
    });
}

// Supabase initialization
const supabaseUrl = 'https://ieriphdzlbuzqqwrymwn.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImllcmlwaGR6bGJ1enFxd3J5bXduIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjIzMDU1MTgsImV4cCI6MjA3Nzg4MTUxOH0.bvbs6joSxf1u9U8SlaAYmjve-N6ArNYcNMtnG6-N_HU';
const supabase = window.supabase.createClient(supabaseUrl, supabaseKey);

// Global variables
let products = [], cart = [], sales = [], deletedSales = [], users = [], currentUser = null;
let currentPage = "pos", isOnline = navigator.onLine, syncQueue = [];
let connectionRetryCount = 0;
const MAX_RETRY_ATTEMPTS = 3, RETRY_DELAY = 5000;

// New global variables for extended features
let expenses = [], purchases = [], stockAlerts = [], profitData = [];
let expenseCategories = ['Rent', 'Utilities', 'Salaries', 'Supplies', 'Marketing', 'Maintenance', 'Other'];

// Settings - Changed from const to let to allow reassignment
let settings = {
    storeName: "Pa Gerrys Mart",
    storeAddress: "Alatishe, Ibeju Lekki, Lagos State, Nigeria",
    storePhone: "+2347037850121",
    lowStockThreshold: 10,
    expiryWarningDays: 90
};

// Local storage keys
const STORAGE_KEYS = {
    PRODUCTS: 'pagerrysmart_products',
    SALES: 'pagerrysmart_sales',
    DELETED_SALES: 'pagerrysmart_deleted_sales',
    USERS: 'pagerrysmart_users',
    SETTINGS: 'pagerrysmart_settings',
    CURRENT_USER: 'pagerrysmart_current_user',
    EXPENSES: 'pagerrysmart_expenses',
    PURCHASES: 'pagerrysmart_purchases',
    STOCK_ALERTS: 'pagerrysmart_stock_alerts',
    PROFIT_DATA: 'pagerrysmart_profit_data'
};

// DOM elements
const loginPage = document.getElementById('login-page');
const appContainer = document.getElementById('app-container');
const loginForm = document.getElementById('login-form');
const registerForm = document.getElementById('register-form');
const navLinks = document.querySelectorAll('.nav-link');
const pageContents = document.querySelectorAll('.page-content');
const pageTitle = document.getElementById('page-title');
const currentUserEl = document.getElementById('current-user');
const userRoleEl = document.getElementById('user-role');
const logoutBtn = document.getElementById('logout-btn');
const productsGrid = document.getElementById('products-grid');
const cartItems = document.getElementById('cart-items');
const totalEl = document.getElementById('total');
const inventoryTableBody = document.getElementById('inventory-table-body');
const salesTableBody = document.getElementById('sales-table-body');
const deletedSalesTableBody = document.getElementById('deleted-sales-table-body');
const dailySalesTableBody = document.getElementById('daily-sales-table-body');
const productModal = document.getElementById('product-modal');
const receiptModal = document.getElementById('receipt-modal');
const notification = document.getElementById('notification');
const notificationMessage = document.getElementById('notification-message');
const mobileMenuBtn = document.getElementById('mobile-menu-btn');
const sidebar = document.getElementById('sidebar');

// Connection management
function checkSupabaseConnection() {
    if (!isOnline) {
        updateConnectionStatus('offline', 'Offline');
        return;
    }
    
    updateConnectionStatus('checking', 'Checking connection...');
    
    supabase.from('products').select('count').limit(1)
        .then(() => {
            connectionRetryCount = 0;
            updateConnectionStatus('online', 'Connected');
            if (syncQueue.length > 0) processSyncQueue();
        })
        .catch(error => {
            updateConnectionStatus('offline', 'Connection failed');
            
            if (error.code === '42P17' || error.message.includes('infinite recursion')) {
                showNotification('Database policy issue detected. Some features may be limited.', 'warning');
                return;
            }
            
            if (connectionRetryCount < MAX_RETRY_ATTEMPTS) {
                connectionRetryCount++;
                setTimeout(checkSupabaseConnection, RETRY_DELAY);
            } else {
                showNotification('Connection to database failed. Some features may be limited.', 'warning');
            }
        });
}

function updateConnectionStatus(status, message) {
    const statusEl = document.getElementById('connection-status');
    const textEl = document.getElementById('connection-text');
    
    if (statusEl && textEl) {
        statusEl.className = 'connection-status ' + status;
        textEl.textContent = message;
    }
}

// PWA Install Prompt
let deferredPrompt;
const installBtn = document.getElementById('install-btn');

window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    installBtn.style.display = 'flex';
});

installBtn.addEventListener('click', async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') {
        console.log('User accepted the install prompt');
        installBtn.style.display = 'none';
    }
    deferredPrompt = null;
});

// Online/Offline Detection
window.addEventListener('online', () => {
    isOnline = true;
    document.getElementById('offline-indicator').classList.remove('show');
    showNotification('You are back online!', 'success');
    checkSupabaseConnection();
    setTimeout(refreshAllData, 1000);
});

window.addEventListener('offline', () => {
    isOnline = false;
    document.getElementById('offline-indicator').classList.add('show');
});

// Authentication Module
const AuthModule = {
    async signUp(email, password, name, role = 'cashier') {
        try {
            const { data: { user } } = await supabase.auth.getUser();
            if (!user || !currentUser || currentUser.role !== 'admin') {
                showNotification("Only admins can create new users.", "error");
                return { success: false };
            }

            const adminPassword = prompt("Please confirm your admin password to continue:");
            if (!adminPassword) return { success: false };

            const { error: signInError } = await supabase.auth.signInWithPassword({
                email: currentUser.email,
                password: adminPassword
            });

            if (signInError) {
                showNotification("Incorrect admin password.", "error");
                return { success: false };
            }

            const { data, error } = await supabase.auth.admin.createUser({
                email, password, user_metadata: { name, role }
            });

            if (error) throw error;

            try {
                await supabase.from('users').insert({
                    id: data.user.id, name, email, role,
                    created_at: new Date().toISOString(),
                    last_login: new Date().toISOString(),
                    created_by: user.id
                });
            } catch (dbError) {
                console.warn('Could not save user to database:', dbError);
            }

            showNotification(`User "${name}" (${role}) created successfully!`, "success");
            return { success: true };
        } catch (error) {
            console.error("Signup error:", error);
            showNotification("Error creating user: " + error.message, "error");
            return { success: false, error: error.message };
        }
    },

    async signIn(email, password) {
        const loginSubmitBtn = document.getElementById('login-submit-btn');
        loginSubmitBtn.classList.add('loading');
        loginSubmitBtn.disabled = true;
        
        try {
            const { data, error } = await supabase.auth.signInWithPassword({ email, password });
            if (error) throw error;

            const fallbackUser = {
                id: data.user.id,
                name: data.user.user_metadata?.name || data.user.email?.split('@')[0] || 'User',
                email: data.user.email,
                role: data.user.user_metadata?.role || 'cashier',
                created_at: data.user.created_at,
                last_login: new Date().toISOString()
            };

            try {
                const { data: userData, error: userError } = await supabase
                    .from('users')
                    .select('*')
                    .eq('id', data.user.id)
                    .single();

                if (!userError && userData) {
                    currentUser = userData;
                    try {
                        await supabase
                            .from('users')
                            .update({ last_login: new Date().toISOString() })
                            .eq('id', data.user.id);
                    } catch (updateError) {
                        console.warn('Could not update last login:', updateError);
                    }
                } else {
                    currentUser = fallbackUser;
                    try {
                        const { data: newUser } = await supabase
                            .from('users')
                            .insert(fallbackUser)
                            .select()
                            .single();
                        if (newUser) currentUser = newUser;
                    } catch (insertError) {
                        console.warn('Could not create user in database:', insertError);
                    }
                }
            } catch (fetchError) {
                if (fetchError.message && fetchError.message.includes('infinite recursion')) {
                    showNotification('Database policy issue detected. Using limited functionality.', 'warning');
                }
                currentUser = fallbackUser;
            }
            
            localStorage.setItem(STORAGE_KEYS.CURRENT_USER, JSON.stringify(currentUser));
            showApp();
            showNotification('Login successful!', 'success');
            return { success: true };
        } catch (error) {
            console.error('Signin error:', error);
            showNotification(error.message || 'Login failed', 'error');
            return { success: false, error: error.message };
        } finally {
            loginSubmitBtn.classList.remove('loading');
            loginSubmitBtn.disabled = false;
        }
    },
    
    async signOut() {
        try {
            await supabase.auth.signOut();
            localStorage.removeItem(STORAGE_KEYS.CURRENT_USER);
            currentUser = null;
            showLogin();
            showNotification('Logged out successfully', 'info');
        } catch (error) {
            console.error('Signout error:', error);
            showNotification(error.message, 'error');
        }
    },
    
    isAdmin() {
        return currentUser && currentUser.role === 'admin';
    },
    
    onAuthStateChanged(callback) {
        supabase.auth.getSession().then(({ data: { session } }) => {
            if (session) {
                this.handleExistingSession(session, callback);
            } else {
                supabase.auth.onAuthStateChange(async (event, session) => {
                    if (session) {
                        this.handleExistingSession(session, callback);
                    } else {
                        currentUser = null;
                        localStorage.removeItem(STORAGE_KEYS.CURRENT_USER);
                        callback(null);
                    }
                });
                callback(null);
            }
        });
    },
    
    async handleExistingSession(session, callback) {
        const fallbackUser = {
            id: session.user.id,
            name: session.user.user_metadata?.name || session.user.email?.split('@')[0] || 'User',
            email: session.user.email,
            role: session.user.user_metadata?.role || 'cashier',
            created_at: session.user.created_at,
            last_login: new Date().toISOString()
        };
        
        try {
            const { data: userData, error } = await supabase
                .from('users')
                .select('*')
                .eq('id', session.user.id)
                .single();
            
            if (!error && userData) {
                currentUser = userData;
                localStorage.setItem(STORAGE_KEYS.CURRENT_USER, JSON.stringify(currentUser));
                callback(currentUser);
            } else {
                currentUser = fallbackUser;
                localStorage.setItem(STORAGE_KEYS.CURRENT_USER, JSON.stringify(currentUser));
                callback(currentUser);
                
                try {
                    const { data: newUser } = await supabase
                        .from('users')
                        .insert(fallbackUser)
                        .select()
                        .single();
                    if (newUser) {
                        currentUser = newUser;
                        localStorage.setItem(STORAGE_KEYS.CURRENT_USER, JSON.stringify(currentUser));
                        callback(currentUser);
                    }
                } catch (insertError) {
                    console.warn('Could not create user in database:', insertError);
                }
            }
        } catch (fetchError) {
            if (fetchError.message && fetchError.message.includes('infinite recursion')) {
                showNotification('Database policy issue detected. Using limited functionality.', 'warning');
            }
            currentUser = fallbackUser;
            localStorage.setItem(STORAGE_KEYS.CURRENT_USER, JSON.stringify(currentUser));
            callback(currentUser);
        }
    }
};

// Data Module
const DataModule = {
    async fetchProducts() {
        try {
            if (isOnline) {
                let query = supabase.from('products').select('*');
                
                try {
                    query = query.eq('deleted', false);
                } catch (error) {
                    console.warn('deleted column might not exist, fetching all products');
                }
                
                const { data, error } = await query;
                
                if (error) {
                    if (error.code === '42P17' || error.message.includes('infinite recursion')) {
                        showNotification('Database policy issue for products. Using local cache.', 'warning');
                    } else if (error.code === '42501' || error.message.includes('policy')) {
                        showNotification('Permission denied for products. Using local cache.', 'warning');
                    } else {
                        throw error;
                    }
                } else if (data) {
                    const normalizedProducts = data.map(product => {
                        // IMPORTANT: Handle database column name (expirydate) to internal field (expiryDate)
                        if (product.expirydate && !product.expiryDate) {
                            product.expiryDate = product.expirydate;
                        }
                        return product;
                    });
                    
                    const activeProducts = normalizedProducts.filter(product => !product.deleted);
                    products = this.mergeProductData(activeProducts);
                    saveToLocalStorage();
                    return products;
                }
            }
            return products;
        } catch (error) {
            console.error('Error in fetchProducts:', error);
            if (error.code === '42501' || error.message.includes('policy')) {
                showNotification('Permission denied for products. Using local cache.', 'warning');
            } else if (error.code === '42P17' || error.message.includes('infinite recursion')) {
                showNotification('Database policy issue detected. Using local cache.', 'warning');
            } else {
                showNotification('Error fetching products: ' + error.message, 'error');
            }
            return products;
        }
    },
    
    mergeProductData(serverProducts) {
        const serverProductsMap = {};
        serverProducts.forEach(product => {
            serverProductsMap[product.id] = product;
        });
        
        const localProductsMap = {};
        products.forEach(product => {
            localProductsMap[product.id] = product;
        });
        
        const mergedProducts = [];
        
        serverProducts.forEach(serverProduct => {
            const localProduct = localProductsMap[serverProduct.id];
            
            if (localProduct) {
                const serverDate = new Date(serverProduct.updated_at || serverProduct.created_at || 0);
                const localDate = new Date(localProduct.updated_at || localProduct.created_at || 0);
                
                mergedProducts.push(localDate > serverDate ? localProduct : serverProduct);
            } else {
                mergedProducts.push(serverProduct);
            }
        });
        
        products.forEach(localProduct => {
            if (!serverProductsMap[localProduct.id]) {
                mergedProducts.push(localProduct);
            }
        });
        
        return mergedProducts;
    },
    
    async fetchSales() {
        try {
            if (isOnline) {
                const timeoutPromise = new Promise((_, reject) => 
                    setTimeout(() => reject(new Error('Request timeout')), 15000)
                );
                
                const fetchPromise = supabase
                    .from('sales')
                    .select('*')
                    .order('created_at', { ascending: false });
                
                const { data, error } = await Promise.race([fetchPromise, timeoutPromise]);
                
                if (error) {
                    console.error('Supabase fetch error:', error);
                    if (error.code === '42P17' || error.message.includes('infinite recursion')) {
                        showNotification('Database policy issue for sales. Using local cache.', 'warning');
                    } else if (error.code === '42501' || error.message.includes('policy')) {
                        showNotification('Permission denied for sales. Using local cache.', 'warning');
                    } else {
                        throw error;
                    }
                } else if (data && Array.isArray(data)) {
                    const validatedSales = data.map(sale => {
                        // IMPORTANT: Handle database column name (receiptnumber) to internal field (receiptNumber)
                        if (!sale.receiptNumber && sale.receiptnumber) {
                            sale.receiptNumber = sale.receiptnumber;
                        } else if (!sale.receiptNumber && !sale.receiptnumber) {
                            sale.receiptNumber = `UNKNOWN_${Date.now()}`;
                        }
                        
                        if (!sale.items) sale.items = [];
                        if (typeof sale.total !== 'number') {
                            sale.total = parseFloat(sale.total) || 0;
                        }
                        if (!sale.created_at) {
                            sale.created_at = new Date().toISOString();
                        }
                        return sale;
                    });
                    
                    // Merge with local sales to ensure no data is lost
                    sales = this.mergeSalesData(validatedSales);
                    saveToLocalStorage();
                    return sales;
                }
            }
            return sales;
        } catch (error) {
            console.error('Error in fetchSales:', error);
            if (error.message === 'Request timeout') {
                showNotification('Connection timeout. Using local cache.', 'warning');
            } else if (error.code === '42501' || error.message.includes('policy')) {
                showNotification('Permission denied for sales. Using local cache.', 'warning');
            } else if (error.code === '42P17' || error.message.includes('infinite recursion')) {
                showNotification('Database policy issue detected. Using local cache.', 'warning');
            } else {
                showNotification('Error fetching sales: ' + error.message, 'error');
            }
            return sales;
        }
    },
    
    mergeSalesData(serverSales) {
        const serverSalesMap = {};
        serverSales.forEach(sale => {
            serverSalesMap[sale.receiptNumber] = sale;
        });
        
        const localSalesMap = {};
        sales.forEach(sale => {
            if (sale && sale.receiptNumber) {
                localSalesMap[sale.receiptNumber] = sale;
            }
        });
        
        const mergedSales = [];
        
        serverSales.forEach(serverSale => {
            const localSale = localSalesMap[serverSale.receiptNumber];
            
            if (localSale) {
                const serverDate = new Date(serverSale.updated_at || serverSale.created_at || 0);
                const localDate = new Date(localSale.updated_at || localSale.created_at || 0);
                
                mergedSales.push(localDate > serverDate ? localSale : serverSale);
            } else {
                mergedSales.push(serverSale);
            }
        });
        
        sales.forEach(localSale => {
            if (localSale && localSale.receiptNumber && !serverSalesMap[localSale.receiptNumber]) {
                mergedSales.push(localSale);
            }
        });
        
        mergedSales.sort((a, b) => {
            const dateA = a.created_at ? new Date(a.created_at) : new Date(0);
            const dateB = b.created_at ? new Date(b.created_at) : new Date(0);
            return dateB - dateA;
        });
        
        return mergedSales;
    },
    
    async fetchDeletedSales() {
        try {
            if (isOnline) {
                const { data, error } = await supabase.from('deleted_sales').select('*');
                if (error) throw error;
                deletedSales = data || [];
                saveToLocalStorage();
                return deletedSales;
            }
            return deletedSales;
        } catch (error) {
            console.error('Error fetching deleted sales:', error);
            return deletedSales;
        }
    },
    
    async fetchExpenses() {
        try {
            if (isOnline) {
                const { data, error } = await supabase.from('expenses').select('*').order('date', { ascending: false });
                if (error) throw error;
                expenses = data || [];
                saveToLocalStorage();
                return expenses;
            }
            return expenses;
        } catch (error) {
            console.error('Error in fetchExpenses:', error);
            showNotification('Error fetching expenses: ' + error.message, 'error');
            return expenses;
        }
    },
    
    async saveExpense(expense) {
        try {
            const expenseToSave = {
                ...expense,
                created_at: new Date().toISOString(),
                created_by: currentUser.id
            };
            
            if (isOnline) {
                const { data, error } = await supabase
                    .from('expenses')
                    .insert(expenseToSave)
                    .select();
                
                if (error) throw error;
                
                if (data && data.length > 0) {
                    expenses.unshift(data[0]);
                    saveToLocalStorage();
                    return { success: true, expense: data[0] };
                }
            } else {
                expenseToSave.id = 'temp_' + Date.now();
                expenses.unshift(expenseToSave);
                saveToLocalStorage();
                
                addToSyncQueue({
                    type: 'saveExpense',
                    data: expenseToSave
                });
                
                return { success: true, expense: expenseToSave };
            }
        } catch (error) {
            console.error('Error saving expense:', error);
            showNotification('Error saving expense: ' + error.message, 'error');
            return { success: false, error };
        }
    },
    
    async fetchPurchases() {
        try {
            if (isOnline) {
                const { data, error } = await supabase.from('purchases').select('*').order('date', { ascending: false });
                if (error) throw error;
                purchases = data || [];
                saveToLocalStorage();
                return purchases;
            }
            return purchases;
        } catch (error) {
            console.error('Error in fetchPurchases:', error);
            showNotification('Error fetching purchases: ' + error.message, 'error');
            return purchases;
        }
    },
    
    async savePurchase(purchase) {
        try {
            const purchaseToSave = {
                ...purchase,
                created_at: new Date().toISOString(),
                created_by: currentUser.id
            };
            
            if (isOnline) {
                const { data, error } = await supabase
                    .from('purchases')
                    .insert(purchaseToSave)
                    .select();
                
                if (error) throw error;
                
                if (data && data.length > 0) {
                    purchases.unshift(data[0]);
                    saveToLocalStorage();
                    return { success: true, purchase: data[0] };
                }
            } else {
                purchaseToSave.id = 'temp_' + Date.now();
                purchases.unshift(purchaseToSave);
                saveToLocalStorage();
                
                addToSyncQueue({
                    type: 'savePurchase',
                    data: purchaseToSave
                });
                
                return { success: true, purchase: purchaseToSave };
            }
        } catch (error) {
            console.error('Error saving purchase:', error);
            showNotification('Error saving purchase: ' + error.message, 'error');
            return { success: false, error };
        }
    },
    
    calculateProfit(startDate, endDate) {
        const filteredSales = sales.filter(sale => {
            const saleDate = new Date(sale.created_at);
            return saleDate >= new Date(startDate) && saleDate <= new Date(endDate);
        });
        
        const filteredExpenses = expenses.filter(expense => {
            const expenseDate = new Date(expense.date);
            return expenseDate >= new Date(startDate) && expenseDate <= new Date(endDate);
        });
        
        const totalRevenue = filteredSales.reduce((sum, sale) => sum + sale.total, 0);
        const totalExpenses = filteredExpenses.reduce((sum, expense) => sum + expense.amount, 0);
        
        return {
            revenue: totalRevenue,
            expenses: totalExpenses,
            profit: totalRevenue - totalExpenses,
            salesCount: filteredSales.length,
            expenseCount: filteredExpenses.length
        };
    },
    
    checkStockLevels() {
        const alerts = [];
        const today = new Date();
        
        products.forEach(product => {
            if (product.deleted) return;
            
            // Check for low stock
            if (product.stock <= settings.lowStockThreshold) {
                alerts.push({
                    id: product.id,
                    type: 'low_stock',
                    productId: product.id,
                    productName: product.name,
                    currentStock: product.stock,
                    threshold: settings.lowStockThreshold,
                    message: `Low stock alert: ${product.name} has only ${product.stock} items left (threshold: ${settings.lowStockThreshold})`,
                    created_at: today.toISOString()
                });
            }
            
            // Check for expiry dates
            const expiryDate = new Date(product.expiryDate);
            const daysUntilExpiry = Math.ceil((expiryDate - today) / (1000 * 60 * 60 * 24));
            
            if (daysUntilExpiry <= settings.expiryWarningDays) {
                alerts.push({
                    id: product.id + '_expiry',
                    type: 'expiry_warning',
                    productId: product.id,
                    productName: product.name,
                    expiryDate: product.expiryDate,
                    daysUntilExpiry: daysUntilExpiry,
                    message: `Expiry warning: ${product.name} expires in ${daysUntilExpiry} days`,
                    created_at: today.toISOString()
                });
            }
        });
        
        stockAlerts = alerts;
        saveToLocalStorage();
        return alerts;
    },
    
    detectDiscrepancies() {
        const discrepancies = [];
        
        // Check for sales with negative or zero totals
        sales.forEach(sale => {
            if (sale.total <= 0) {
                discrepancies.push({
                    type: 'invalid_sale_total',
                    saleId: sale.id,
                    receiptNumber: sale.receiptNumber,
                    message: `Sale with receipt #${sale.receiptNumber} has an invalid total: ${sale.total}`,
                    created_at: new Date().toISOString()
                });
            }
            
            // Check for sales with empty items
            if (!sale.items || sale.items.length === 0) {
                discrepancies.push({
                    type: 'empty_sale_items',
                    saleId: sale.id,
                    receiptNumber: sale.receiptNumber,
                    message: `Sale with receipt #${sale.receiptNumber} has no items`,
                    created_at: new Date().toISOString()
                });
            }
        });
        
        // Check for products with negative stock
        products.forEach(product => {
            if (product.stock < 0) {
                discrepancies.push({
                    type: 'negative_stock',
                    productId: product.id,
                    productName: product.name,
                    currentStock: product.stock,
                    message: `Product ${product.name} has negative stock: ${product.stock}`,
                    created_at: new Date().toISOString()
                });
            }
        });
        
        return discrepancies;
    },
    
    async saveProduct(product) {
        const productModalLoading = document.getElementById('product-modal-loading');
        const saveProductBtn = document.getElementById('save-product-btn');
        
        if (productModalLoading) productModalLoading.style.display = 'flex';
        if (saveProductBtn) {
            saveProductBtn.disabled = true;
        }
        
        try {
            if (!product.name || !product.category || !product.price || !product.stock || !product.expiryDate) {
                throw new Error('Please fill in all required fields');
            }
            
            if (isNaN(product.price) || product.price <= 0) {
                throw new Error('Please enter a valid price');
            }
            
            if (isNaN(product.stock) || product.stock < 0) {
                throw new Error('Please enter a valid stock quantity');
            }
            
            // IMPORTANT: Use the correct database column names (lowercase)
            const productToSave = {
                name: product.name,
                category: product.category,
                price: parseFloat(product.price),
                stock: parseInt(product.stock),
                expirydate: product.expiryDate,  // Database column: expirydate
                barcode: product.barcode || null
            };
            
            let result;
            
            if (product.id && !product.id.startsWith('temp_')) {
                const { data, error } = await supabase
                    .from('products')
                    .update(productToSave)
                    .eq('id', product.id)
                    .select();
                
                if (error) throw error;
                result = { success: true, product: data[0] || product };
            } else {
                const { data, error } = await supabase
                    .from('products')
                    .insert(productToSave)
                    .select();
                
                if (error) throw error;
                
                if (data && data.length > 0) {
                    product.id = data[0].id;
                    result = { success: true, product: data[0] };
                } else {
                    result = { success: true, product };
                }
            }
            
            if (product.id && !product.id.startsWith('temp_')) {
                const index = products.findIndex(p => p.id === product.id);
                if (index >= 0) products[index] = product;
            } else {
                products.push(product);
            }
            
            saveToLocalStorage();
            return result;
            
        } catch (error) {
            console.error('Error saving product:', error);
            
            if (error.message.includes('Failed to fetch') || error.message.includes('NetworkError')) {
                showNotification('Network error. Product saved locally only.', 'warning');
                
                if (product.id && !product.id.startsWith('temp_')) {
                    const index = products.findIndex(p => p.id === product.id);
                    if (index >= 0) products[index] = product;
                } else {
                    product.id = 'temp_' + Date.now();
                    products.push(product);
                }
                saveToLocalStorage();
                
                addToSyncQueue({
                    type: 'saveProduct',
                    data: product
                });
                
                return { success: true, product };
            } else {
                showNotification('Error saving product: ' + error.message, 'error');
                return { success: false, error: error.message };
            }
        } finally {
            if (productModalLoading) productModalLoading.style.display = 'none';
            if (saveProductBtn) {
                saveProductBtn.disabled = false;
            }
        }
    },
    
    async deleteProduct(productId) {
        try {
            const index = products.findIndex(p => p.id === productId);
            if (index >= 0) {
                products[index].deleted = true;
                products[index].deletedAt = new Date().toISOString();
                saveToLocalStorage();
            }
            
            if (isOnline) {
                try {
                    const { error: updateError } = await supabase
                        .from('products')
                        .update({ 
                            deleted: true, 
                            deletedAt: new Date().toISOString() 
                        })
                        .eq('id', productId);
                    
                    if (updateError) {
                        const { error: deleteError } = await supabase
                            .from('products')
                            .delete()
                            .eq('id', productId);
                        
                        if (deleteError) throw deleteError;
                        products = products.filter(p => p.id !== productId);
                        saveToLocalStorage();
                    }
                    return { success: true };
                } catch (dbError) {
                    console.error('Database delete failed:', dbError);
                    showNotification('Failed to delete from database. Marked as deleted locally.', 'warning');
                    
                    addToSyncQueue({
                        type: 'deleteProduct',
                        id: productId
                    });
                    
                    return { success: true };
                }
            } else {
                addToSyncQueue({
                    type: 'deleteProduct',
                    id: productId
                });
                
                return { success: true };
            }
        } catch (error) {
            console.error('Error deleting product:', error);
            showNotification('Error deleting product', 'error');
            return { success: false, error };
        }
    },
    
    async saveSale(sale) {
        try {
            const existingSale = sales.find(s => s.receiptNumber === sale.receiptNumber);
            if (existingSale) {
                return { success: true, sale: existingSale };
            }

            // Always save locally first
            const localResult = this.saveSaleLocally(sale);

            if (isOnline) {
                try {
                    // Simplify the user ID validation
                    let validCashierId = currentUser?.id || '00000000-0000-0000-0000-000000000000';
                    
                    // If it's not a valid UUID, use the fallback ID
                    if (!validCashierId.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i)) {
                        validCashierId = '00000000-0000-0000-0000-000000000000';
                    }
                    
                    // IMPORTANT: Use the correct database column names (lowercase)
                    const saleToSave = {
                        receiptnumber: sale.receiptNumber,  // Database column: receiptnumber
                        cashierid: validCashierId,          // Database column: cashierid
                        items: sale.items,
                        total: sale.total,
                        created_at: sale.created_at,
                        cashier: sale.cashier
                    };
                    
                    const { data, error } = await supabase
                        .from('sales')
                        .insert(saleToSave)
                        .select();
                    
                    if (error) {
                        console.error('Supabase error:', error);
                        throw error;
                    }
                    
                    if (data && data.length > 0) {
                        // Update the local sale with the Supabase ID
                        const index = sales.findIndex(s => s.receiptNumber === sale.receiptNumber);
                        if (index >= 0) {
                            sales[index].id = data[0].id;
                            sales[index].cashierId = validCashierId;
                            saveToLocalStorage();
                        }
                        return { success: true, sale: { ...sale, id: data[0].id, cashierId: validCashierId } };
                    } else {
                        throw new Error('No data returned from insert operation');
                    }
                } catch (dbError) {
                    console.error('Database operation failed:', dbError);
                    showNotification('Database error: ' + dbError.message + '. Sale saved locally and will sync when connection is restored.', 'warning');
                    
                    // Add to sync queue to try again later
                    addToSyncQueue({
                        type: 'saveSale',
                        data: sale
                    });
                    
                    return localResult;
                }
            } else {
                // If offline, add to sync queue
                addToSyncQueue({
                    type: 'saveSale',
                    data: sale
                });
                
                return localResult;
            }
        } catch (error) {
            console.error('Error saving sale:', error);
            showNotification('Error saving sale', 'error');
            return { success: false, error };
        }
    },
    
    saveSaleLocally(sale) {
        sale.id = 'temp_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
        sales.push(sale);
        saveToLocalStorage();
        return { success: true, sale };
    },
    
    async deleteSale(saleId) {
        try {
            const saleIndex = sales.findIndex(s => s.id === saleId);
            if (saleIndex >= 0) {
                const sale = sales[saleIndex];
                sale.deleted = true;
                sale.deletedAt = new Date().toISOString();
                deletedSales.push(sale);
                sales.splice(saleIndex, 1);
                saveToLocalStorage();
            }
            
            if (isOnline) {
                try {
                    const { data: saleData, error: fetchError } = await supabase
                        .from('sales')
                        .select('*')
                        .eq('id', saleId)
                        .single();
                    
                    if (fetchError) throw fetchError;
                    
                    if (saleData) {
                        saleData.deleted = true;
                        saleData.deletedAt = new Date().toISOString();
                        
                        const { error: insertError } = await supabase
                            .from('deleted_sales')
                            .insert(saleData);
                        
                        if (insertError) throw insertError;
                        
                        const { error: deleteError } = await supabase
                            .from('sales')
                            .delete()
                            .eq('id', saleId);
                        
                        if (deleteError) throw deleteError;
                        
                        return { success: true };
                    } else {
                        return { success: false, error: 'Sale not found' };
                    }
                } catch (dbError) {
                    console.error('Database delete failed:', dbError);
                    showNotification('Failed to delete from database. Marked as deleted locally.', 'warning');
                    
                    addToSyncQueue({
                        type: 'deleteSale',
                        id: saleId
                    });
                    
                    return { success: true };
                }
            } else {
                addToSyncQueue({
                    type: 'deleteSale',
                    id: saleId
                });
                
                return { success: true };
            }
        } catch (error) {
            console.error('Error deleting sale:', error);
            showNotification('Error deleting sale', 'error');
            return { success: false, error };
        }
    }
};

// Sync Queue Management
function addToSyncQueue(operation) {
    if (!operation.id) {
        operation.id = 'op_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    }
    
    operation.timestamp = new Date().toISOString();
    
    if (operation.type === 'saveSale') {
        const receiptNumber = operation.data.receiptNumber;
        const existingIndex = syncQueue.findIndex(op => 
            op.type === 'saveSale' && 
            op.data.receiptNumber === receiptNumber
        );
        
        if (existingIndex !== -1) {
            syncQueue[existingIndex] = operation;
        } else {
            syncQueue.push(operation);
        }
    } else if (operation.type === 'saveProduct') {
        if (operation.data.stock !== undefined && !operation.data.name) {
            const existingIndex = syncQueue.findIndex(op => 
                op.type === 'saveProduct' && 
                op.data.id === operation.data.id && 
                op.data.stock !== undefined
            );
            
            if (existingIndex !== -1) {
                syncQueue[existingIndex].data.stock = operation.data.stock;
            } else {
                syncQueue.push(operation);
            }
        } else {
            const existingIndex = syncQueue.findIndex(op => 
                op.type === operation.type && 
                op.data.id === operation.data.id
            );
            
            if (existingIndex !== -1) {
                syncQueue[existingIndex] = operation;
            } else {
                syncQueue.push(operation);
            }
        }
    } else {
        const existingIndex = syncQueue.findIndex(op => 
            op.type === operation.type && 
            op.id === operation.id
        );
        
        if (existingIndex !== -1) {
            syncQueue[existingIndex] = operation;
        } else {
            syncQueue.push(operation);
        }
    }
    
    localStorage.setItem('syncQueue', JSON.stringify(syncQueue));
    
    if (isOnline) {
        processSyncQueue();
    } else {
        showNotification('Offline: Operation saved locally and will sync automatically.', 'info');
    }
}

async function processSyncQueue() {
    if (syncQueue.length === 0) return;
    
    const syncStatus = document.getElementById('sync-status');
    const syncStatusText = document.getElementById('sync-status-text');
    
    if (syncStatus) {
        syncStatus.classList.add('show', 'syncing');
        syncStatusText.textContent = `Syncing ${syncQueue.length} operations...`;
    }
    
    syncQueue.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
    
    for (let i = 0; i < syncQueue.length; i++) {
        const operation = syncQueue[i];
        
        if (operation.synced) continue;
        
        try {
            let success = false;
            
            if (operation.type === 'saveSale') {
                success = await syncSale(operation);
            } else if (operation.type === 'saveProduct') {
                success = await syncProduct(operation);
            } else if (operation.type === 'deleteProduct') {
                success = await syncDeleteProduct(operation);
            } else if (operation.type === 'deleteSale') {
                success = await syncDeleteSale(operation);
            } else if (operation.type === 'saveExpense') {
                success = await syncExpense(operation);
            } else if (operation.type === 'savePurchase') {
                success = await syncPurchase(operation);
            }
            
            if (success) {
                operation.synced = true;
                operation.syncedAt = new Date().toISOString();
            }
        } catch (error) {
            console.error(`Error syncing operation:`, operation.type, error);
        }
        
        await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    localStorage.setItem('syncQueue', JSON.stringify(syncQueue));
    
    const originalLength = syncQueue.length;
    syncQueue = syncQueue.filter(op => !op.synced);
    
    if (syncQueue.length < originalLength) {
        localStorage.setItem('syncQueue', JSON.stringify(syncQueue));
    }
    
    if (syncStatus && syncStatusText) {
        if (syncQueue.length === 0) {
            syncStatus.classList.remove('syncing');
            syncStatus.classList.add('show');
            syncStatusText.textContent = 'All data synced';
            setTimeout(() => syncStatus.classList.remove('show'), 3000);
            await refreshAllData();
        } else {
            syncStatus.classList.remove('syncing');
            syncStatus.classList.add('error');
            syncStatusText.textContent = `${syncQueue.length} operations pending`;
            setTimeout(() => syncStatus.classList.remove('show', 'error'), 3000);
        }
    }
}

async function ensureValidUserId(userId) {
    if (!userId) return null;
    
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (uuidRegex.test(userId)) {
        try {
            const { data, error } = await supabase
                .from('users')
                .select('id')
                .eq('id', userId)
                .single();
            
            if (!error && data) return userId;
        } catch (error) {
            console.error('Error checking user ID:', error);
        }
    }
    
    if (currentUser && currentUser.email) {
        try {
            const { data, error } = await supabase
                .from('users')
                .select('id')
                .eq('email', currentUser.email)
                .single();
            
            if (!error && data) {
                currentUser.id = data.id;
                localStorage.setItem(STORAGE_KEYS.CURRENT_USER, JSON.stringify(currentUser));
                return data.id;
            }
        } catch (error) {
            console.error('Error finding user by email:', error);
        }
    }
    
    return '00000000-0000-0000-0000-000000000000';
}

async function syncSale(operation) {
    try {
        let validCashierId = operation.data.cashierId || '00000000-0000-0000-0000-000000000000';
        
        // If it's not a valid UUID, use the fallback ID
        if (!validCashierId.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i)) {
            validCashierId = '00000000-0000-0000-0000-000000000000';
        }
        
        operation.data.cashierId = validCashierId;
        
        // IMPORTANT: Use receiptnumber (lowercase) to match the database column
        const { data: existingSales, error: fetchError } = await supabase
            .from('sales')
            .select('*')
            .eq('receiptnumber', operation.data.receiptNumber);  // Database column: receiptnumber
        
        if (fetchError) throw fetchError;
        
        if (!existingSales || existingSales.length === 0) {
            // IMPORTANT: Use the correct database column names (lowercase)
            const saleToSave = {
                receiptnumber: operation.data.receiptNumber,  // Database column: receiptnumber
                cashierid: validCashierId,                    // Database column: cashierid
                items: operation.data.items,
                total: operation.data.total,
                created_at: operation.data.created_at,
                cashier: operation.data.cashier
            };
            
            const { data, error } = await supabase
                .from('sales')
                .insert(saleToSave)
                .select();
            
            if (error) throw error;
            
            if (data && data.length > 0) {
                const localSaleIndex = sales.findIndex(s => s.receiptNumber === operation.data.receiptNumber);
                if (localSaleIndex !== -1) {
                    sales[localSaleIndex].id = data[0].id;
                    sales[localSaleIndex].cashierId = validCashierId;
                    saveToLocalStorage();
                }
                return true;
            }
        } else {
            if (existingSales.length > 0) {
                const localSaleIndex = sales.findIndex(s => s.receiptNumber === operation.data.receiptNumber);
                if (localSaleIndex !== -1) {
                    sales[localSaleIndex].id = existingSales[0].id;
                    sales[localSaleIndex].cashierId = validCashierId;
                    saveToLocalStorage();
                }
            }
            return true;
        }
        
        return false;
    } catch (error) {
        console.error('Error syncing sale:', error);
        return false;
    }
}

async function syncProduct(operation) {
    try {
        if (operation.data.stock !== undefined && !operation.data.name) {
            // IMPORTANT: Use the correct database column names (lowercase)
            const { error } = await supabase
                .from('products')
                .update({ stock: operation.data.stock })
                .eq('id', operation.data.id);
            
            if (error) throw error;
        } else {
            if (operation.data.id && !operation.data.id.startsWith('temp_')) {
                // IMPORTANT: Use the correct database column names (lowercase)
                const productToSave = {
                    name: operation.data.name,
                    category: operation.data.category,
                    price: operation.data.price,
                    stock: operation.data.stock,
                    expirydate: operation.data.expiryDate,  // Database column: expirydate
                    barcode: operation.data.barcode
                };
                
                const { error } = await supabase
                    .from('products')
                    .update(productToSave)
                    .eq('id', operation.data.id);
                
                if (error) throw error;
            } else {
                // IMPORTANT: Use the correct database column names (lowercase)
                const productToSave = {
                    name: operation.data.name,
                    category: operation.data.category,
                    price: operation.data.price,
                    stock: operation.data.stock,
                    expirydate: operation.data.expiryDate,  // Database column: expirydate
                    barcode: operation.data.barcode
                };
                
                const { data, error } = await supabase
                    .from('products')
                    .insert(productToSave)
                    .select();
                
                if (error) throw error;
                
                if (data && data.length > 0) {
                    const localProductIndex = products.findIndex(p => p.id === operation.data.id);
                    if (localProductIndex !== -1) {
                        products[localProductIndex].id = data[0].id;
                        saveToLocalStorage();
                    }
                }
            }
        }
        
        return true;
    } catch (error) {
        console.error('Error syncing product:', error);
        return false;
    }
}

async function syncDeleteProduct(operation) {
    try {
        const { error } = await supabase
            .from('products')
            .delete()
            .eq('id', operation.id);
        
        if (error) throw error;
        return true;
    } catch (error) {
        console.error('Error syncing product deletion:', error);
        return false;
    }
}

async function syncDeleteSale(operation) {
    try {
        const { data: saleData, error: fetchError } = await supabase
            .from('sales')
            .select('*')
            .eq('id', operation.id)
            .single();
        
        if (fetchError) throw fetchError;
        
        if (saleData) {
            saleData.deleted = true;
            saleData.deletedAt = new Date().toISOString();
            
            const { error: insertError } = await supabase
                .from('deleted_sales')
                .insert(saleData);
            
            if (insertError) throw insertError;
            
            const { error: deleteError } = await supabase
                .from('sales')
                .delete()
                .eq('id', operation.id);
            
            if (deleteError) throw deleteError;
        }
        
        return true;
    } catch (error) {
        console.error('Error syncing sale deletion:', error);
        return false;
    }
}

async function syncExpense(operation) {
    try {
        const { data, error } = await supabase
            .from('expenses')
            .insert(operation.data)
            .select();
        
        if (error) throw error;
        
        if (data && data.length > 0) {
            const localExpenseIndex = expenses.findIndex(e => e.id === operation.data.id);
            if (localExpenseIndex !== -1) {
                expenses[localExpenseIndex].id = data[0].id;
                saveToLocalStorage();
            }
            return true;
        }
        
        return false;
    } catch (error) {
        console.error('Error syncing expense:', error);
        return false;
    }
}

async function syncPurchase(operation) {
    try {
        const { data, error } = await supabase
            .from('purchases')
            .insert(operation.data)
            .select();
        
        if (error) throw error;
        
        if (data && data.length > 0) {
            const localPurchaseIndex = purchases.findIndex(p => p.id === operation.data.id);
            if (localPurchaseIndex !== -1) {
                purchases[localPurchaseIndex].id = data[0].id;
                saveToLocalStorage();
            }
            return true;
        }
        
        return false;
    } catch (error) {
        console.error('Error syncing purchase:', error);
        return false;
    }
}

function loadSyncQueue() {
    const savedQueue = localStorage.getItem('syncQueue');
    if (savedQueue) {
        try {
            syncQueue = JSON.parse(savedQueue);
            
            const weekAgo = new Date();
            weekAgo.setDate(weekAgo.getDate() - 7);
            
            const originalLength = syncQueue.length;
            syncQueue = syncQueue.filter(op => {
                const opDate = new Date(op.timestamp || 0);
                return opDate > weekAgo;
            });
            
            if (syncQueue.length < originalLength) {
                localStorage.setItem('syncQueue', JSON.stringify(syncQueue));
            }
        } catch (e) {
            console.error('Error parsing sync queue:', e);
            syncQueue = [];
        }
    }
}

function cleanupSyncQueue() {
    syncQueue = syncQueue.filter(op => !op.synced);
    localStorage.setItem('syncQueue', JSON.stringify(syncQueue));
}

function cleanupDuplicateSales() {
    const receiptNumbers = new Set();
    const uniqueSales = [];
    
    sales.forEach(sale => {
        if (!receiptNumbers.has(sale.receiptNumber)) {
            receiptNumbers.add(sale.receiptNumber);
            uniqueSales.push(sale);
        }
    });
    
    if (sales.length !== uniqueSales.length) {
        sales = uniqueSales;
        saveToLocalStorage();
    }
}

function setupRealtimeListeners() {
    if (isOnline) {
        supabase
            .channel('products-changes')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'products' }, () => {
                DataModule.fetchProducts().then(updatedProducts => {
                    products = updatedProducts;
                    saveToLocalStorage();
                    loadProducts();
                });
            })
            .subscribe();
        
        supabase
            .channel('sales-changes')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'sales' }, () => {
                DataModule.fetchSales().then(updatedSales => {
                    sales = updatedSales;
                    saveToLocalStorage();
                    loadSales();
                });
            })
            .subscribe();
        
        supabase
            .channel('deleted-sales-changes')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'deleted_sales' }, () => {
                DataModule.fetchDeletedSales().then(updatedDeletedSales => {
                    deletedSales = updatedDeletedSales;
                    saveToLocalStorage();
                    loadDeletedSales();
                });
            })
            .subscribe();
        
        supabase
            .channel('expenses-changes')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'expenses' }, () => {
                DataModule.fetchExpenses().then(updatedExpenses => {
                    expenses = updatedExpenses;
                    saveToLocalStorage();
                    if (currentPage === 'expenses') {
                        loadExpenses();
                    }
                });
            })
            .subscribe();
        
        supabase
            .channel('purchases-changes')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'purchases' }, () => {
                DataModule.fetchPurchases().then(updatedPurchases => {
                    purchases = updatedPurchases;
                    saveToLocalStorage();
                    if (currentPage === 'purchases') {
                        loadPurchases();
                    }
                });
            })
            .subscribe();
    }
}

// Local Storage Functions
function loadFromLocalStorage() {
    try {
        // Initialize empty arrays/objects first
        products = [];
        sales = [];
        deletedSales = [];
        users = [];
        currentUser = null;
        expenses = [];
        purchases = [];
        stockAlerts = [];
        profitData = [];
        
        // Load products
        const savedProducts = localStorage.getItem(STORAGE_KEYS.PRODUCTS);
        if (savedProducts) {
            try {
                const parsedProducts = JSON.parse(savedProducts);
                if (Array.isArray(parsedProducts)) {
                    products = parsedProducts;
                }
            } catch (parseError) {
                console.error('Error parsing products from localStorage:', parseError);
            }
        }
        
        // Load sales
        const savedSales = localStorage.getItem(STORAGE_KEYS.SALES);
        if (savedSales) {
            try {
                const parsedSales = JSON.parse(savedSales);
                if (Array.isArray(parsedSales)) {
                    sales = parsedSales;
                }
            } catch (parseError) {
                console.error('Error parsing sales from localStorage:', parseError);
            }
        }
        
        // Load deleted sales
        const savedDeletedSales = localStorage.getItem(STORAGE_KEYS.DELETED_SALES);
        if (savedDeletedSales) {
            try {
                const parsedDeletedSales = JSON.parse(savedDeletedSales);
                if (Array.isArray(parsedDeletedSales)) {
                    deletedSales = parsedDeletedSales;
                }
            } catch (parseError) {
                console.error('Error parsing deleted sales from localStorage:', parseError);
            }
        }
        
        // Load users
        const savedUsers = localStorage.getItem(STORAGE_KEYS.USERS);
        if (savedUsers) {
            try {
                const parsedUsers = JSON.parse(savedUsers);
                if (Array.isArray(parsedUsers)) {
                    users = parsedUsers;
                }
            } catch (parseError) {
                console.error('Error parsing users from localStorage:', parseError);
            }
        }
        
        // Load settings - Update properties of the existing settings object
        const savedSettings = localStorage.getItem(STORAGE_KEYS.SETTINGS);
        if (savedSettings) {
            try {
                const parsedSettings = JSON.parse(savedSettings);
                if (parsedSettings && typeof parsedSettings === 'object') {
                    // Update properties of the existing settings object instead of reassigning
                    Object.assign(settings, parsedSettings);
                }
            } catch (parseError) {
                console.error('Error parsing settings from localStorage:', parseError);
            }
        }
        
        // Load current user
        const savedCurrentUser = localStorage.getItem(STORAGE_KEYS.CURRENT_USER);
        if (savedCurrentUser) {
            try {
                const parsedCurrentUser = JSON.parse(savedCurrentUser);
                if (parsedCurrentUser && typeof parsedCurrentUser === 'object') {
                    currentUser = parsedCurrentUser;
                }
            } catch (parseError) {
                console.error('Error parsing current user from localStorage:', parseError);
            }
        }
        
        // Load expenses
        const savedExpenses = localStorage.getItem(STORAGE_KEYS.EXPENSES);
        if (savedExpenses) {
            try {
                expenses = JSON.parse(savedExpenses);
            } catch (parseError) {
                console.error('Error parsing expenses from localStorage:', parseError);
                expenses = [];
            }
        }
        
        // Load purchases
        const savedPurchases = localStorage.getItem(STORAGE_KEYS.PURCHASES);
        if (savedPurchases) {
            try {
                purchases = JSON.parse(savedPurchases);
            } catch (parseError) {
                console.error('Error parsing purchases from localStorage:', parseError);
                purchases = [];
            }
        }
        
        // Load stock alerts
        const savedStockAlerts = localStorage.getItem(STORAGE_KEYS.STOCK_ALERTS);
        if (savedStockAlerts) {
            try {
                stockAlerts = JSON.parse(savedStockAlerts);
            } catch (parseError) {
                console.error('Error parsing stock alerts from localStorage:', parseError);
                stockAlerts = [];
            }
        }
        
        // Load profit data
        const savedProfitData = localStorage.getItem(STORAGE_KEYS.PROFIT_DATA);
        if (savedProfitData) {
            try {
                profitData = JSON.parse(savedProfitData);
            } catch (parseError) {
                console.error('Error parsing profit data from localStorage:', parseError);
                profitData = [];
            }
        }
    } catch (e) {
        console.error('Error loading data from localStorage:', e);
        // Reset to defaults on error
        products = [];
        sales = [];
        deletedSales = [];
        users = [];
        currentUser = null;
        expenses = [];
        purchases = [];
        stockAlerts = [];
        profitData = [];
    }
}

function saveToLocalStorage() {
    try {
        localStorage.setItem(STORAGE_KEYS.PRODUCTS, JSON.stringify(products));
        localStorage.setItem(STORAGE_KEYS.SALES, JSON.stringify(sales));
        localStorage.setItem(STORAGE_KEYS.DELETED_SALES, JSON.stringify(deletedSales));
        localStorage.setItem(STORAGE_KEYS.USERS, JSON.stringify(users));
        localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(settings));
        localStorage.setItem(STORAGE_KEYS.EXPENSES, JSON.stringify(expenses));
        localStorage.setItem(STORAGE_KEYS.PURCHASES, JSON.stringify(purchases));
        localStorage.setItem(STORAGE_KEYS.STOCK_ALERTS, JSON.stringify(stockAlerts));
        localStorage.setItem(STORAGE_KEYS.PROFIT_DATA, JSON.stringify(profitData));
        
        if (currentUser) {
            localStorage.setItem(STORAGE_KEYS.CURRENT_USER, JSON.stringify(currentUser));
        }
    } catch (e) {
        console.error('Error saving data to localStorage:', e);
        showNotification('Error saving data locally. Some changes may be lost.', 'error');
    }
}

function validateDataStructure() {
    let isValid = true;
    
    if (!Array.isArray(products)) {
        products = [];
        isValid = false;
    }
    
    if (!Array.isArray(sales)) {
        sales = [];
        isValid = false;
    }
    
    if (!Array.isArray(deletedSales)) {
        deletedSales = [];
        isValid = false;
    }
    
    if (!Array.isArray(users)) {
        users = [];
        isValid = false;
    }
    
    if (!Array.isArray(expenses)) {
        expenses = [];
        isValid = false;
    }
    
    if (!Array.isArray(purchases)) {
        purchases = [];
        isValid = false;
    }
    
    if (!Array.isArray(stockAlerts)) {
        stockAlerts = [];
        isValid = false;
    }
    
    if (!Array.isArray(profitData)) {
        profitData = [];
        isValid = false;
    }
    
    if (!settings || typeof settings !== 'object') {
        settings = {
            storeName: "Pa Gerrys Mart",
            storeAddress: "Alatishe, Ibeju Lekki, Lagos State, Nigeria",
            storePhone: "+2347037850121",
            lowStockThreshold: 10,
            expiryWarningDays: 90
        };
        isValid = false;
    }
    
    if (!isValid) {
        saveToLocalStorage();
    }
    
    return isValid;
}

function validateSalesData() {
    let isValid = true;
    
    if (!Array.isArray(sales)) {
        sales = [];
        isValid = false;
    }
    
    sales.forEach((sale, index) => {
        if (!sale || typeof sale !== 'object') {
            isValid = false;
            return;
        }
        
        if (!sale.receiptNumber) {
            isValid = false;
        }
        
        if (!sale.created_at) {
            isValid = false;
        }
        
        if (typeof sale.total !== 'number' || isNaN(sale.total)) {
            isValid = false;
        }
        
        if (!Array.isArray(sale.items)) {
            isValid = false;
        }
    });
    
    if (!isValid) {
        showNotification('Sales data validation failed. Some data may be missing.', 'warning');
    }
    
    return isValid;
}

// UI Functions
function showLogin() {
    loginPage.style.display = 'flex';
    appContainer.style.display = 'none';
}

function initChangePasswordForm() {
    if (currentUser && currentUser.email) {
        const changePasswordForm = document.getElementById('change-password-form');
        if (changePasswordForm && !document.getElementById('change-password-username')) {
            const usernameField = document.createElement('input');
            usernameField.type = 'email';
            usernameField.id = 'change-password-username';
            usernameField.name = 'username';
            usernameField.value = currentUser.email;
            usernameField.style.display = 'none';
            usernameField.setAttribute('aria-hidden', 'true');
            usernameField.setAttribute('tabindex', '-1');
            usernameField.setAttribute('autocomplete', 'username');
            
            changePasswordForm.insertBefore(usernameField, changePasswordForm.firstChild);
        }
    }
}

async function showApp() {
    loginPage.style.display = 'none';
    appContainer.style.display = 'flex';
    
    if (currentUser) {
        currentUserEl.textContent = currentUser.name;
        userRoleEl.textContent = currentUser.role;
        
        const usersContainer = document.getElementById('users-container');
        if (AuthModule.isAdmin()) {
            usersContainer.style.display = 'block';
        } else {
            usersContainer.style.display = 'none';
        }
        
        const addProductBtns = document.querySelectorAll('.add-product-btn');
        addProductBtns.forEach(btn => {
            btn.style.display = AuthModule.isAdmin() ? 'block' : 'none';
        });
        
        initChangePasswordForm();
    }
    
    try {
        // Fetch products and sales in parallel
        const [productsResult, salesResult] = await Promise.allSettled([
            DataModule.fetchProducts(),
            DataModule.fetchSales()
        ]);
        
        if (productsResult.status === 'fulfilled') {
            products = productsResult.value;
        }
        
        if (salesResult.status === 'fulfilled') {
            sales = salesResult.value;
        } else {
            validateSalesData();
        }
        
        if (deletedSales.length === 0) {
            const deletedSalesResult = await DataModule.fetchDeletedSales();
            if (deletedSalesResult) {
                deletedSales = deletedSalesResult;
            }
        }
        
        // Load expenses and purchases
        if (expenses.length === 0) {
            await DataModule.fetchExpenses();
        }
        
        if (purchases.length === 0) {
            await DataModule.fetchPurchases();
        }
        
        loadProducts();
        loadSales();
        setupRealtimeListeners();
    } catch (error) {
        console.error('Error loading initial data:', error);
        showNotification('Error loading data. Using offline cache.', 'warning');
        
        loadProducts();
        loadSales();
        setupRealtimeListeners();
    }
}

function showNotification(message, type = 'success') {
    notificationMessage.textContent = message;
    notification.className = `notification ${type} show`;
    
    const icon = notification.querySelector('i');
    icon.className = type === 'success' ? 'fas fa-check-circle' : 
                   type === 'error' ? 'fas fa-exclamation-circle' : 
                   type === 'warning' ? 'fas fa-exclamation-triangle' : 
                   'fas fa-info-circle';
    
    setTimeout(() => {
        notification.classList.remove('show');
    }, 3000);
}

function formatCurrency(amount) {
    return new Intl.NumberFormat('en-NG', { 
        style: 'currency', 
        currency: 'NGN',
        minimumFractionDigits: 2
    }).format(amount);
}

function formatDate(date, short = false) {
    if (!date) return '-';
    
    if (typeof date === 'string') {
        const d = new Date(date);
        
        if (isNaN(d.getTime())) {
            return '-';
        }
        
        if (short) {
            return d.toLocaleDateString();
        }
        
        return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
    }
    
    const d = date instanceof Date ? date : new Date(date);
    
    if (isNaN(d.getTime())) {
        return '-';
    }
    
    if (short) {
        return d.toLocaleDateString();
    }
    
    return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
}

function generateReceiptNumber() {
    const date = new Date();
    const year = date.getFullYear().toString().substr(-2);
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const day = date.getDate().toString().padStart(2, '0');
    const random = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
    
    return `R${year}${month}${day}${random}`;
}

// Page Navigation
function showPage(pageName) {
    pageContents.forEach(page => {
        page.style.display = 'none';
    });
    
    const selectedPage = document.getElementById(`${pageName}-page`);
    if (selectedPage) {
        selectedPage.style.display = 'block';
    }
    
    navLinks.forEach(link => {
        link.classList.remove('active');
        if (link.getAttribute('data-page') === pageName) {
            link.classList.add('active');
        }
    });
    
    const titles = {
        'pos': 'Point of Sale',
        'inventory': 'Inventory Management',
        'reports': 'Sales Reports',
        'expenses': 'Expense Management',
        'purchases': 'Purchase Management',
        'analytics': 'Business Analytics',
        'account': 'My Account'
    };
    
    pageTitle.textContent = titles[pageName] || 'Pa Gerrys Mart';
    currentPage = pageName;
    
    if (pageName === 'inventory') {
        loadInventory();
    } else if (pageName === 'reports') {
        loadReports();
    } else if (pageName === 'account') {
        loadAccount();
    } else if (pageName === 'expenses') {
        loadExpenses();
    } else if (pageName === 'purchases') {
        loadPurchases();
    } else if (pageName === 'analytics') {
        loadAnalytics();
    }
}

function validateProductData(product) {
    const validatedProduct = { ...product };
    
    if (!validatedProduct.name) validatedProduct.name = 'Unnamed Product';
    if (!validatedProduct.category) validatedProduct.category = 'Uncategorized';
    if (!validatedProduct.price || isNaN(validatedProduct.price)) validatedProduct.price = 0;
    if (!validatedProduct.stock || isNaN(validatedProduct.stock)) validatedProduct.stock = 0;
    if (!validatedProduct.expiryDate) {
        const date = new Date();
        date.setFullYear(date.getFullYear() + 1);
        validatedProduct.expiryDate = date.toISOString().split('T')[0];
    }
    
    validatedProduct.price = parseFloat(validatedProduct.price);
    validatedProduct.stock = parseInt(validatedProduct.stock);
    validatedProduct.expirydate = validatedProduct.expiryDate;
    
    return validatedProduct;
}

// Product Functions
function loadProducts() {
    if (products.length === 0) {
        productsGrid.innerHTML = `
            <div class="empty-state">
                <i class="fas fa-box-open"></i>
                <h3>No Products Added Yet</h3>
                <p>Click "Add Product" to start adding your inventory</p>
            </div>
        `;
        return;
    }
    
    productsGrid.innerHTML = '';
    
    products.forEach(product => {
        if (product.deleted) return;
        
        const productCard = document.createElement('div');
        productCard.className = 'product-card';
        
        const today = new Date();
        const expiryDate = new Date(product.expiryDate);
        const daysUntilExpiry = Math.ceil((expiryDate - today) / (1000 * 60 * 60 * 24));
        
        let expiryWarning = '';
        let productNameStyle = '';
        
        if (daysUntilExpiry < 0) {
            expiryWarning = `<div class="expiry-warning"><i class="fas fa-exclamation-triangle"></i> Expired</div>`;
            productNameStyle = 'style="color: red; font-weight: bold;"';
        } else if (daysUntilExpiry <= settings.expiryWarningDays) {
            expiryWarning = `<div class="expiry-warning"><i class="fas fa-clock"></i> Expires in ${daysUntilExpiry} days</div>`;
            productNameStyle = 'style="color: red; font-weight: bold;"';
        }
        
        let stockClass = 'stock-high';
        if (product.stock <= 0) {
            stockClass = 'stock-low';
        } else if (product.stock <= settings.lowStockThreshold) {
            stockClass = 'stock-medium';
        }
        
        productCard.innerHTML = `
            <div class="product-img">
                <i class="fas fa-box"></i>
            </div>
            <h4 ${productNameStyle}>${product.name}</h4>
            <div class="price">${formatCurrency(product.price)}</div>
            <div class="stock ${stockClass}">Stock: ${product.stock}</div>
            ${expiryWarning}
        `;
        
        productCard.addEventListener('click', () => addToCart(product));
        productsGrid.appendChild(productCard);
    });
}

function loadInventory() {
    const inventoryLoading = document.getElementById('inventory-loading');
    if (inventoryLoading) inventoryLoading.style.display = 'flex';
    
    setTimeout(() => {
        if (inventoryLoading) inventoryLoading.style.display = 'none';
        
        if (products.length === 0) {
            inventoryTableBody.innerHTML = `
                <tr>
                    <td colspan="8" style="text-align: center;">No products in inventory</td>
                </tr>
            `;
            const inventoryTotalValue = document.getElementById('inventory-total-value');
            if (inventoryTotalValue) inventoryTotalValue.textContent = formatCurrency(0);
            return;
        }
        
        let totalValue = 0;
        inventoryTableBody.innerHTML = '';
        
        products.forEach(product => {
            if (product.deleted) return;
            
            totalValue += product.price * product.stock;
            
            const today = new Date();
            const expiryDate = new Date(product.expiryDate);
            const daysUntilExpiry = Math.ceil((expiryDate - today) / (1000 * 60 * 60 * 24));
            
            let rowClass = '';
            let stockBadgeClass = 'stock-high';
            let stockBadgeText = 'In Stock';
            let productNameStyle = '';
            
            if (product.stock <= 0) {
                stockBadgeClass = 'stock-low';
                stockBadgeText = 'Out of Stock';
            } else if (product.stock <= settings.lowStockThreshold) {
                stockBadgeClass = 'stock-medium';
                stockBadgeText = 'Low Stock';
            }
            
            let expiryBadgeClass = 'expiry-good';
            let expiryBadgeText = 'Good';
            
            if (daysUntilExpiry < 0) {
                expiryBadgeClass = 'expiry-expired';
                expiryBadgeText = 'Expired';
                rowClass = 'expired';
                productNameStyle = 'style="color: red; font-weight: bold;"';
            } else if (daysUntilExpiry <= settings.expiryWarningDays) {
                expiryBadgeClass = 'expiry-warning';
                expiryBadgeText = 'Expiring Soon';
                rowClass = 'expiring-soon';
                productNameStyle = 'style="color: red; font-weight: bold;"';
            }
            
            const row = document.createElement('tr');
            if (rowClass) row.className = rowClass;
            
            let actionButtons = '';
            if (AuthModule.isAdmin()) {
                actionButtons = `
                    <div class="action-buttons">
                        <button class="btn-edit" onclick="editProduct('${product.id}')">
                            <i class="fas fa-edit"></i>
                        </button>
                        <button class="btn-delete" onclick="deleteProduct('${product.id}')">
                            <i class="fas fa-trash"></i>
                        </button>
                    </div>
                `;
            } else {
                actionButtons = '<span class="no-permission">Admin only</span>';
            }
            
            row.innerHTML = `
                <td>${product.id}</td>
                <td ${productNameStyle}>${product.name}</td>
                <td>${product.category}</td>
                <td>${formatCurrency(product.price)}</td>
                <td>${product.stock}</td>
                <td>${formatDate(product.expiryDate)}</td>
                <td>
                    <span class="stock-badge ${stockBadgeClass}">${stockBadgeText}</span>
                    <span class="expiry-badge ${expiryBadgeClass}">${expiryBadgeText}</span>
                </td>
                <td>
                    ${actionButtons}
                </td>
            `;
            
            inventoryTableBody.appendChild(row);
        });
        
        const inventoryTotalValue = document.getElementById('inventory-total-value');
        if (inventoryTotalValue) inventoryTotalValue.textContent = formatCurrency(totalValue);
    }, 500);
}

function loadSales() {
    updateSalesTables();
    
    if (currentPage === 'reports') {
        generateReport();
    }
}

function loadDeletedSales() {
    updateSalesTables();
}

function updateSalesTables() {
    if (sales.length === 0) {
        salesTableBody.innerHTML = `
            <tr>
                <td colspan="5" style="text-align: center;">No sales data available</td>
            </tr>
        `;
    } else {
        salesTableBody.innerHTML = '';
        
        const sortedSales = [...sales].sort((a, b) => {
            const dateA = a.created_at ? new Date(a.created_at) : new Date(0);
            const dateB = b.created_at ? new Date(b.created_at) : new Date(0);
            return dateB - dateA;
        });
        
        const recentSales = sortedSales.slice(0, 10);
        
        recentSales.forEach(sale => {
            const row = document.createElement('tr');
            
            let actionButtons = `
                <button class="btn-edit" onclick="viewSale('${sale.id}')" title="View Sale">
                    <i class="fas fa-eye"></i>
                </button>
            `;
            
            if (AuthModule.isAdmin()) {
                actionButtons += `
                    <button class="btn-delete" onclick="deleteSale('${sale.id}')" title="Delete Sale">
                        <i class="fas fa-trash"></i>
                    </button>
                `;
            }
            
            const totalItemsSold = sale.items.reduce((sum, item) => sum + item.quantity, 0);
            
            row.innerHTML = `
                <td>${sale.receiptNumber}</td>
                <td>${formatDate(sale.created_at)}</td>
                <td>${totalItemsSold}</td>
                <td>${formatCurrency(sale.total)}</td>
                <td>
                    <div class="action-buttons">
                        ${actionButtons}
                    </div>
                </td>
            `;
            
            salesTableBody.appendChild(row);
        });
    }
    
    if (deletedSales.length === 0) {
        deletedSalesTableBody.innerHTML = `
            <tr>
                <td colspan="5" style="text-align: center;">No deleted sales</td>
            </tr>
        `;
    } else {
        deletedSalesTableBody.innerHTML = '';
        
        const sortedDeletedSales = [...deletedSales].sort((a, b) => {
            const dateA = a.deletedAt ? new Date(a.deletedAt) : new Date(0);
            const dateB = b.deletedAt ? new Date(b.deletedAt) : new Date(0);
            return dateB - dateA;
        });
        
        sortedDeletedSales.forEach(sale => {
            const row = document.createElement('tr');
            
            const totalItemsSold = sale.items.reduce((sum, item) => sum + item.quantity, 0);
            
            row.innerHTML = `
                <td>${sale.receiptNumber}</td>
                <td>${formatDate(sale.created_at)}</td>
                <td>${totalItemsSold}</td>
                <td>${formatCurrency(sale.total)}</td>
                <td><span class="deleted-badge">Deleted</span></td>
            `;
            
            deletedSalesTableBody.appendChild(row);
        });
    }
}

function loadReports() {
    const reportsLoading = document.getElementById('reports-loading');
    if (reportsLoading) reportsLoading.style.display = 'flex';
    
    const today = new Date().toISOString().split('T')[0];
    const reportDateEl = document.getElementById('report-date');
    if (reportDateEl) {
        reportDateEl.value = today;
    }
    
    setTimeout(() => {
        if (reportsLoading) reportsLoading.style.display = 'none';
        
        if (sales.length === 0) {
            DataModule.fetchSales().then(fetchedSales => {
                sales = fetchedSales;
                generateReport();
            }).catch(error => {
                console.error('Error fetching sales for report:', error);
                generateReport();
            });
        } else {
            generateReport();
        }
    }, 500);
}

function generateReport() {
    try {
        const reportDateEl = document.getElementById('report-date');
        const selectedDate = reportDateEl ? reportDateEl.value : new Date().toISOString().split('T')[0];
        
        const salesData = Array.isArray(sales) ? sales : [];
        
        let totalSales = 0;
        let totalTransactions = 0;
        let totalItemsSold = 0;
        
        salesData.forEach(sale => {
            if (!sale || typeof sale !== 'object') return;
            
            totalSales += sale.total || 0;
            totalTransactions++;
            
            if (Array.isArray(sale.items)) {
                sale.items.forEach(item => {
                    totalItemsSold += item.quantity || 0;
                });
            }
        });
        
        const totalSalesEl = document.getElementById('report-total-sales');
        const totalTransactionsEl = document.getElementById('report-transactions');
        const totalItemsSoldEl = document.getElementById('report-items-sold');
        
        if (totalSalesEl) totalSalesEl.textContent = formatCurrency(totalSales);
        if (totalTransactionsEl) totalTransactionsEl.textContent = totalTransactions;
        if (totalItemsSoldEl) totalItemsSoldEl.textContent = totalItemsSold;
        
        let dailyTotal = 0;
        let dailyTransactions = 0;
        let dailyItems = 0;
        
        const dailySales = [];
        
        salesData.forEach(sale => {
            if (!sale || typeof sale !== 'object' || !sale.created_at) return;
            
            const saleDate = new Date(sale.created_at);
            
            if (isNaN(saleDate.getTime())) return;
            
            const saleDateString = saleDate.toISOString().split('T')[0];
            
            if (saleDateString === selectedDate) {
                dailyTotal += sale.total || 0;
                dailyTransactions++;
                
                if (Array.isArray(sale.items)) {
                    sale.items.forEach(item => {
                        dailyItems += item.quantity || 0;
                    });
                }
                dailySales.push(sale);
            }
        });
        
        const dailyTotalEl = document.getElementById('daily-total-sales');
        const dailyTransactionsEl = document.getElementById('daily-transactions');
        const dailyItemsEl = document.getElementById('daily-items-sold');
        
        if (dailyTotalEl) dailyTotalEl.textContent = formatCurrency(dailyTotal);
        if (dailyTransactionsEl) dailyTransactionsEl.textContent = dailyTransactions;
        if (dailyItemsEl) dailyItemsEl.textContent = dailyItems;
        
        if (!dailySalesTableBody) {
            console.error('dailySalesTableBody element not found');
            return;
        }
        
        if (dailySales.length === 0) {
            dailySalesTableBody.innerHTML = `
                <tr>
                    <td colspan="5" class="no-data">No sales data for selected date</td>
                </tr>
            `;
        } else {
            dailySalesTableBody.innerHTML = '';
            
            dailySales.sort((a, b) => {
                const dateA = a.created_at ? new Date(a.created_at) : new Date(0);
                const dateB = b.created_at ? new Date(b.created_at) : new Date(0);
                return dateB - dateA;
            });
            
            dailySales.forEach(sale => {
                const row = document.createElement('tr');
                
                let actionButtons = `
                    <button class="btn-edit" onclick="viewSale('${sale.id}')" title="View Sale">
                        <i class="fas fa-eye"></i>
                    </button>
                `;
                
                if (AuthModule.isAdmin()) {
                    actionButtons += `
                        <button class="btn-delete" onclick="deleteSale('${sale.id}')" title="Delete Sale">
                            <i class="fas fa-trash"></i>
                        </button>
                    `;
                }
                
                const totalItemsSold = Array.isArray(sale.items) 
                    ? sale.items.reduce((sum, item) => sum + (item.quantity || 0), 0)
                    : 0;
                
                row.innerHTML = `
                    <td>${sale.receiptNumber || 'N/A'}</td>
                    <td>${formatDate(sale.created_at)}</td>
                    <td>${totalItemsSold}</td>
                    <td>${formatCurrency(sale.total || 0)}</td>
                    <td>
                        <div class="action-buttons">
                            ${actionButtons}
                        </div>
                    </td>
                `;
                
                dailySalesTableBody.appendChild(row);
            });
        }
    } catch (error) {
        console.error('Error generating report:', error);
        showNotification('Error generating report: ' + error.message, 'error');
    }
}

function loadAccount() {
    const accountLoading = document.getElementById('account-loading');
    if (accountLoading) accountLoading.style.display = 'flex';
    
    setTimeout(() => {
        if (accountLoading) accountLoading.style.display = 'none';
        
        if (currentUser) {
            const userNameEl = document.getElementById('user-name');
            const userEmailEl = document.getElementById('user-email');
            const userRoleDisplayEl = document.getElementById('user-role-display');
            const userCreatedEl = document.getElementById('user-created');
            const userLastLoginEl = document.getElementById('user-last-login');
            
            if (userNameEl) userNameEl.textContent = currentUser.name;
            if (userEmailEl) userEmailEl.textContent = currentUser.email;
            if (userRoleDisplayEl) userRoleDisplayEl.textContent = currentUser.role;
            if (userCreatedEl) userCreatedEl.textContent = formatDate(currentUser.created_at);
            if (userLastLoginEl) userLastLoginEl.textContent = formatDate(currentUser.last_login);
        }
        
        if (AuthModule.isAdmin()) {
            loadUsers();
        }
    }, 500);
}

function loadUsers() {
    const usersList = document.getElementById('users-list');
    if (!usersList) return;
    
    usersList.innerHTML = '';
    
    if (users.length === 0) {
        usersList.innerHTML = '<p>No users found</p>';
        return;
    }
    
    users.forEach(user => {
        const userCard = document.createElement('div');
        userCard.className = 'user-card';
        
        userCard.innerHTML = `
            <div class="user-info">
                <strong>${user.name}</strong>
                <span>${user.email}</span>
                <span class="role-badge ${user.role}">${user.role}</span>
            </div>
            <div class="action-buttons">
                <button class="btn-delete" onclick="deleteUser('${user.id}')">
                    <i class="fas fa-trash"></i>
                </button>
            </div>
        `;
        
        usersList.appendChild(userCard);
    });
}

// Cart Functions
function addToCart(product) {
    if (product.stock <= 0) {
        showNotification('Product is out of stock', 'error');
        return;
    }
    
    const existingItem = cart.find(item => item.id === product.id);
    
    if (existingItem) {
        if (existingItem.quantity >= product.stock) {
            showNotification('Not enough stock available', 'error');
            return;
        }
        
        existingItem.quantity++;
    } else {
        cart.push({
            id: product.id,
            name: product.name,
            price: product.price,
            quantity: 1
        });
    }
    
    updateCart();
}

function updateCart() {
    if (cart.length === 0) {
        cartItems.innerHTML = '<p style="text-align: center; color: #999; padding: 20px;">No items in cart</p>';
        totalEl.textContent = formatCurrency(0);
        return;
    }
    
    cartItems.innerHTML = '';
    let total = 0;
    
    cart.forEach(item => {
        const itemTotal = item.price * item.quantity;
        total += itemTotal;
        
        const cartItem = document.createElement('div');
        cartItem.className = 'cart-item';
        
        cartItem.innerHTML = `
            <div class="cart-item-info">
                <div class="cart-item-name">${item.name}</div>
                <div class="cart-item-price">${formatCurrency(item.price)}</div>
                <div class="cart-item-qty">
                    <button onclick="updateQuantity('${item.id}', -1)">-</button>
                    <input type="number" value="${item.quantity}" min="1" readonly>
                    <button onclick="updateQuantity('${item.id}', 1)">+</button>
                </div>
            </div>
            <div class="cart-item-total">${formatCurrency(itemTotal)}</div>
        `;
        
        cartItems.appendChild(cartItem);
    });
    
    totalEl.textContent = formatCurrency(total);
}

function updateQuantity(productId, change) {
    const item = cart.find(item => item.id === productId);
    if (!item) return;
    
    const product = products.find(p => p.id === productId);
    if (!product) return;
    
    const newQuantity = item.quantity + change;
    
    if (newQuantity <= 0) {
        cart = cart.filter(item => item.id !== productId);
    } else if (newQuantity <= product.stock) {
        item.quantity = newQuantity;
    } else {
        showNotification('Not enough stock available', 'error');
        return;
    }
    
    updateCart();
}

function clearCart() {
    cart = [];
    updateCart();
}

async function completeSale() {
    if (cart.length === 0) {
        showNotification('Cart is empty', 'error');
        return;
    }
    
    const completeSaleBtn = document.getElementById('complete-sale-btn');
    completeSaleBtn.classList.add('loading');
    completeSaleBtn.disabled = true;
    
    try {
        let validCashierId = currentUser?.id || '00000000-0000-0000-0000-000000000000';
        
        // If it's not a valid UUID, use the fallback ID
        if (!validCashierId.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i)) {
            validCashierId = '00000000-0000-0000-0000-000000000000';
        }
        
        const sale = {
            receiptNumber: generateReceiptNumber(),
            clientSaleId: 'client_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9),
            items: [...cart],
            total: cart.reduce((sum, item) => sum + (item.price * item.quantity), 0),
            created_at: new Date().toISOString(),
            cashier: currentUser.name,
            cashierId: validCashierId
        };
        
        const result = await DataModule.saveSale(sale);
        
        if (result.success) {
            for (const cartItem of cart) {
                const product = products.find(p => p.id === cartItem.id);
                if (product) {
                    product.stock -= cartItem.quantity;
                    
                    addToSyncQueue({
                        type: 'saveProduct',
                        data: {
                            id: product.id,
                            stock: product.stock
                        }
                    });
                }
            }
            
            saveToLocalStorage();
            
            showReceipt(result.sale);
            
            cart = [];
            updateCart();
            
            loadSales();
            
            showNotification('Sale completed successfully', 'success');
        } else {
            showNotification('Failed to complete sale', 'error');
        }
    } catch (error) {
        console.error('Error completing sale:', error);
        showNotification('Error completing sale', 'error');
    } finally {
        completeSaleBtn.classList.remove('loading');
        completeSaleBtn.disabled = false;
    }
}

function showReceipt(sale) {
    const receiptContent = document.getElementById('receipt-content');
    if (!receiptContent) return;
    
    let itemsHtml = '';
    sale.items.forEach(item => {
        itemsHtml += `
            <div class="receipt-item">
                <span>${item.name} x${item.quantity}</span>
                <span>${formatCurrency(item.price * item.quantity)}</span>
            </div>
        `;
    });
    
    receiptContent.innerHTML = `
        <div class="receipt-header">
            <h2>${settings.storeName}</h2>
            <p>${settings.storeAddress}</p>
            <p>${settings.storePhone}</p>
        </div>
        <div class="receipt-items">
            ${itemsHtml}
        </div>
        <div class="receipt-footer">
            <div class="receipt-total">
                <span>Total:</span>
                <span>${formatCurrency(sale.total)}</span>
            </div>
            <div class="receipt-item">
                <span>Receipt #:</span>
                <span>${sale.receiptNumber}</span>
            </div>
            <div class="receipt-item">
                <span>Date:</span>
                <span>${formatDate(sale.created_at)}</span>
            </div>
            <div class="receipt-item">
                <span>Cashier:</span>
                <span>${sale.cashier}</span>
            </div>
        </div>
    `;
    
    receiptModal.style.display = 'flex';
}

function printReceipt() {
    const receiptContent = document.getElementById('receipt-content');
    if (!receiptContent) return;
    
    const content = receiptContent.innerHTML;
    
    const printWindow = window.open('', '_blank');
    printWindow.document.write(`
        <html>
            <head>
                <title>Receipt - ${settings.storeName}</title>
                <style>
                    body { font-family: 'Courier New', monospace; padding: 20px; }
                    .receipt-header { text-align: center; margin-bottom: 20px; }
                    .receipt-items { margin-bottom: 20px; }
                    .receipt-item { display: flex; justify-content: space-between; margin-bottom: 8px; }
                    .receipt-footer { border-top: 1px dashed #ccc; padding-top: 10px; }
                    .receipt-total { display: flex; justify-content: space-between; font-weight: 700; margin-bottom: 5px; }
                </style>
            </head>
            <body>
                ${content}
            </body>
        </html>
    `);
    
    printWindow.document.close();
    printWindow.print();
}

// Product Modal Functions
function openProductModal(product = null) {
    if (!AuthModule.isAdmin()) {
        showNotification('Only admins can add or edit products', 'error');
        return;
    }
    
    const modalTitle = document.getElementById('modal-title');
    const productForm = document.getElementById('product-form');
    
    if (product) {
        if (modalTitle) modalTitle.textContent = 'Edit Product';
        const productNameEl = document.getElementById('product-name');
        const productCategoryEl = document.getElementById('product-category');
        const productPriceEl = document.getElementById('product-price');
        const productStockEl = document.getElementById('product-stock');
        const productExpiryEl = document.getElementById('product-expiry');
        const productBarcodeEl = document.getElementById('product-barcode');
        
        if (productNameEl) productNameEl.value = product.name;
        if (productCategoryEl) productCategoryEl.value = product.category;
        if (productPriceEl) productPriceEl.value = product.price;
        if (productStockEl) productStockEl.value = product.stock;
        if (productExpiryEl) productExpiryEl.value = product.expiryDate;
        if (productBarcodeEl) productBarcodeEl.value = product.barcode || '';
        
        if (productForm) productForm.dataset.productId = product.id;
    } else {
        if (modalTitle) modalTitle.textContent = 'Add New Product';
        if (productForm) {
            productForm.reset();
            delete productForm.dataset.productId;
        }
    }
    
    productModal.style.display = 'flex';
}

function closeProductModal() {
    productModal.style.display = 'none';
}

async function saveProduct() {
    if (!AuthModule.isAdmin()) {
        showNotification('Only admins can add or edit products', 'error');
        return;
    }
    
    const productForm = document.getElementById('product-form');
    if (!productForm) return;
    
    const productId = productForm.dataset.productId;
    
    const productNameEl = document.getElementById('product-name');
    const productCategoryEl = document.getElementById('product-category');
    const productPriceEl = document.getElementById('product-price');
    const productStockEl = document.getElementById('product-stock');
    const productExpiryEl = document.getElementById('product-expiry');
    const productBarcodeEl = document.getElementById('product-barcode');
    
    const productData = validateProductData({
        name: productNameEl ? productNameEl.value : '',
        category: productCategoryEl ? productCategoryEl.value : '',
        price: parseFloat(productPriceEl ? productPriceEl.value : 0),
        stock: parseInt(productStockEl ? productStockEl.value : 0),
        expiryDate: productExpiryEl ? productExpiryEl.value : '',
        barcode: productBarcodeEl ? productBarcodeEl.value : ''
    });
    
    if (productId) {
        productData.id = productId;
    }
    
    const result = await DataModule.saveProduct(productData);
    
    if (result.success) {
        closeProductModal();
        products = await DataModule.fetchProducts();
        loadProducts();
        
        if (currentPage === 'inventory') {
            loadInventory();
        }
        showNotification(productId ? 'Product updated successfully' : 'Product added successfully', 'success');
    }
}

function editProduct(productId) {
    if (!AuthModule.isAdmin()) {
        showNotification('Only admins can edit products', 'error');
        return;
    }
    
    const product = products.find(p => p.id === productId);
    if (product) {
        openProductModal(product);
    }
}

async function deleteProduct(productId) {
    if (!AuthModule.isAdmin()) {
        showNotification('Only admins can delete products', 'error');
        return;
    }
    
    if (!confirm('Are you sure you want to delete this product?')) {
        return;
    }
    
    const result = await DataModule.deleteProduct(productId);
    
    if (result.success) {
        products = await DataModule.fetchProducts();
        loadProducts();
        
        if (currentPage === 'inventory') {
            loadInventory();
        }
        showNotification('Product deleted successfully', 'success');
    } else {
        showNotification('Failed to delete product', 'error');
    }
}

function viewSale(saleId) {
    const sale = sales.find(s => s.id === saleId);
    if (sale) {
        showReceipt(sale);
    }
}

async function deleteSale(saleId) {
    if (!AuthModule.isAdmin()) {
        showNotification('You do not have permission to delete sales', 'error');
        return;
    }
    
    const sale = sales.find(s => s.id === saleId);
    if (!sale) {
        showNotification('Sale not found', 'error');
        return;
    }
    
    const confirmMessage = `Are you sure you want to delete this sale?\n\n` +
        `Receipt #: ${sale.receiptNumber}\n` +
        `Date: ${formatDate(sale.created_at)}\n` +
        `Total: ${formatCurrency(sale.total)}\n\n` +
        `This action cannot be undone.`;
    
    if (!confirm(confirmMessage)) {
        return;
    }
    
    try {
        const result = await DataModule.deleteSale(saleId);
        
        if (result.success) {
            showNotification('Sale deleted successfully', 'success');
            
            sales = await DataModule.fetchSales();
            updateSalesTables();
            
            if (currentPage === 'reports') {
                generateReport();
            }
        } else {
            showNotification('Failed to delete sale', 'error');
        }
    } catch (error) {
        console.error('Error deleting sale:', error);
        showNotification('Error deleting sale', 'error');
    }
}

async function refreshAllData() {
    try {
        const syncStatus = document.getElementById('sync-status');
        const syncStatusText = document.getElementById('sync-status-text');
        
        if (syncStatus) {
            syncStatus.classList.add('show', 'syncing');
            syncStatusText.textContent = 'Syncing all data...';
        }
        
        let newProducts = [];
        let newSales = [];
        let newDeletedSales = [];
        let newExpenses = [];
        let newPurchases = [];
        
        try {
            newProducts = await DataModule.fetchProducts();
        } catch (error) {
            console.error('Error fetching products:', error);
            newProducts = products;
        }
        
        try {
            newSales = await DataModule.fetchSales();
        } catch (error) {
            console.error('Error fetching sales:', error);
            newSales = sales;
        }
        
        try {
            newDeletedSales = await DataModule.fetchDeletedSales();
        } catch (error) {
            console.error('Error fetching deleted sales:', error);
            newDeletedSales = deletedSales;
        }
        
        try {
            newExpenses = await DataModule.fetchExpenses();
        } catch (error) {
            console.error('Error fetching expenses:', error);
            newExpenses = expenses;
        }
        
        try {
            newPurchases = await DataModule.fetchPurchases();
        } catch (error) {
            console.error('Error fetching purchases:', error);
            newPurchases = purchases;
        }
        
        products = newProducts;
        sales = newSales;
        deletedSales = newDeletedSales;
        expenses = newExpenses;
        purchases = newPurchases;
        
        validateSalesData();
        
        saveToLocalStorage();
        
        loadProducts();
        loadSales();
        
        if (currentPage === 'inventory') {
            loadInventory();
        } else if (currentPage === 'reports') {
            generateReport();
        } else if (currentPage === 'account') {
            loadAccount();
        } else if (currentPage === 'expenses') {
            loadExpenses();
        } else if (currentPage === 'purchases') {
            loadPurchases();
        } else if (currentPage === 'analytics') {
            loadAnalytics();
        }
        
        if (syncQueue.length > 0) {
            await processSyncQueue();
        }
        
        if (syncStatus && syncStatusText) {
            syncStatus.classList.remove('syncing');
            syncStatus.classList.add('show');
            syncStatusText.textContent = 'All data synced';
            setTimeout(() => syncStatus.classList.remove('show'), 3000);
        }
        
        showNotification('All data synchronized successfully!', 'success');
        
    } catch (error) {
        console.error('Error refreshing data:', error);
        
        const syncStatus = document.getElementById('sync-status');
        const syncStatusText = document.getElementById('sync-status-text');
        
        if (syncStatus && syncStatusText) {
            syncStatus.classList.remove('syncing');
            syncStatus.classList.add('error');
            syncStatusText.textContent = 'Sync error';
            setTimeout(() => syncStatus.classList.remove('show', 'error'), 3000);
        }
        
        showNotification('Error syncing data. Please try again.', 'error');
    }
}

// New UI Functions for Expenses
function showExpensesPage() {
    const expensesPage = document.getElementById('expenses-page');
    if (!expensesPage) {
        createExpensesPage();
    }
    
    showPage('expenses');
    loadExpenses();
}

function createExpensesPage() {
    const mainContent = document.querySelector('.main-content');
    
    const expensesPage = document.createElement('div');
    expensesPage.id = 'expenses-page';
    expensesPage.className = 'page-content';
    
    expensesPage.innerHTML = `
        <div class="page-header">
            <h2>Expense Management</h2>
            <div class="page-actions">
                <button id="add-expense-btn" class="btn btn-primary">
                    <i class="fas fa-plus"></i> Add Expense
                </button>
                <button id="refresh-expenses-btn" class="btn btn-secondary">
                    <i class="fas fa-sync"></i> Refresh
                </button>
            </div>
        </div>
        
        <div class="expense-summary">
            <div class="summary-card">
                <h3>Total Expenses (This Month)</h3>
                <p id="monthly-expenses-total">${formatCurrency(0)}</p>
            </div>
            <div class="summary-card">
                <h3>Total Expenses (This Year)</h3>
                <p id="yearly-expenses-total">${formatCurrency(0)}</p>
            </div>
            <div class="summary-card">
                <h3>Expense Categories</h3>
                <div id="expense-categories-chart"></div>
            </div>
        </div>
        
        <div class="table-container">
            <div class="table-header">
                <h3>Recent Expenses</h3>
                <div class="table-actions">
                    <input type="text" id="expense-search" placeholder="Search expenses...">
                    <select id="expense-filter-category">
                        <option value="">All Categories</option>
                    </select>
                    <input type="date" id="expense-filter-date">
                </div>
            </div>
            <div class="loading" id="expenses-loading" style="display: none;">
                <i class="fas fa-spinner fa-spin"></i> Loading expenses...
            </div>
            <table class="data-table">
                <thead>
                    <tr>
                        <th>Date</th>
                        <th>Description</th>
                        <th>Category</th>
                        <th>Amount</th>
                        <th>Actions</th>
                    </tr>
                </thead>
                <tbody id="expenses-table-body">
                    <tr>
                        <td colspan="5" style="text-align: center;">No expenses data available</td>
                    </tr>
                </tbody>
            </table>
        </div>
    `;
    
    mainContent.appendChild(expensesPage);
    
    // Add event listeners
    document.getElementById('add-expense-btn').addEventListener('click', openExpenseModal);
    document.getElementById('refresh-expenses-btn').addEventListener('click', refreshExpenses);
    document.getElementById('expense-search').addEventListener('input', filterExpenses);
    document.getElementById('expense-filter-category').addEventListener('change', filterExpenses);
    document.getElementById('expense-filter-date').addEventListener('change', filterExpenses);
    
    // Populate category filter
    const categoryFilter = document.getElementById('expense-filter-category');
    expenseCategories.forEach(category => {
        const option = document.createElement('option');
        option.value = category;
        option.textContent = category;
        categoryFilter.appendChild(option);
    });
}

// Create expense modal
function createExpenseModal() {
    const modal = document.createElement('div');
    modal.id = 'expense-modal';
    modal.className = 'modal';
    
    modal.innerHTML = `
        <div class="modal-content">
            <div class="modal-header">
                <h3 id="expense-modal-title">Add Expense</h3>
                <button class="modal-close">&times;</button>
            </div>
            <div class="modal-body">
                <form id="expense-form">
                    <div class="form-group">
                        <label for="expense-date">Date</label>
                        <input type="date" id="expense-date" required>
                    </div>
                    <div class="form-group">
                        <label for="expense-description">Description</label>
                        <input type="text" id="expense-description" required>
                    </div>
                    <div class="form-group">
                        <label for="expense-category">Category</label>
                        <select id="expense-category" required>
                            <option value="">Select Category</option>
                        </select>
                    </div>
                    <div class="form-group">
                        <label for="expense-amount">Amount</label>
                        <input type="number" id="expense-amount" step="0.01" min="0" required>
                    </div>
                    <div class="form-group">
                        <label for="expense-receipt">Receipt/Invoice #</label>
                        <input type="text" id="expense-receipt">
                    </div>
                    <div class="form-group">
                        <label for="expense-notes">Notes</label>
                        <textarea id="expense-notes" rows="3"></textarea>
                    </div>
                </form>
            </div>
            <div class="modal-footer">
                <button id="save-expense-btn" class="btn btn-primary">Save Expense</button>
                <button id="cancel-expense-btn" class="btn btn-secondary">Cancel</button>
            </div>
            <div class="modal-loading" id="expense-modal-loading" style="display: none;">
                <i class="fas fa-spinner fa-spin"></i> Saving expense...
            </div>
        </div>
    `;
    
    document.body.appendChild(modal);
    
    // Populate category dropdown
    const categorySelect = document.getElementById('expense-category');
    expenseCategories.forEach(category => {
        const option = document.createElement('option');
        option.value = category;
        option.textContent = category;
        categorySelect.appendChild(option);
    });
    
    // Add event listeners
    document.querySelector('#expense-modal .modal-close').addEventListener('click', closeExpenseModal);
    document.getElementById('cancel-expense-btn').addEventListener('click', closeExpenseModal);
    document.getElementById('save-expense-btn').addEventListener('click', saveExpense);
    
    // Set default date to today
    document.getElementById('expense-date').valueAsDate = new Date();
}

function openExpenseModal(expense = null) {
    if (!document.getElementById('expense-modal')) {
        createExpenseModal();
    }
    
    const modalTitle = document.getElementById('expense-modal-title');
    const expenseForm = document.getElementById('expense-form');
    
    if (expense) {
        modalTitle.textContent = 'Edit Expense';
        document.getElementById('expense-date').value = expense.date;
        document.getElementById('expense-description').value = expense.description;
        document.getElementById('expense-category').value = expense.category;
        document.getElementById('expense-amount').value = expense.amount;
        document.getElementById('expense-receipt').value = expense.receipt || '';
        document.getElementById('expense-notes').value = expense.notes || '';
        
        expenseForm.dataset.expenseId = expense.id;
    } else {
        modalTitle.textContent = 'Add Expense';
        expenseForm.reset();
        document.getElementById('expense-date').valueAsDate = new Date();
        delete expenseForm.dataset.expenseId;
    }
    
    document.getElementById('expense-modal').style.display = 'flex';
}

function closeExpenseModal() {
    document.getElementById('expense-modal').style.display = 'none';
}

async function saveExpense() {
    const expenseForm = document.getElementById('expense-form');
    const expenseId = expenseForm.dataset.expenseId;
    
    const expenseData = {
        date: document.getElementById('expense-date').value,
        description: document.getElementById('expense-description').value,
        category: document.getElementById('expense-category').value,
        amount: parseFloat(document.getElementById('expense-amount').value),
        receipt: document.getElementById('expense-receipt').value,
        notes: document.getElementById('expense-notes').value
    };
    
    if (expenseId) {
        expenseData.id = expenseId;
    }
    
    const modalLoading = document.getElementById('expense-modal-loading');
    const saveBtn = document.getElementById('save-expense-btn');
    
    modalLoading.style.display = 'flex';
    saveBtn.disabled = true;
    
    try {
        const result = await DataModule.saveExpense(expenseData);
        
        if (result.success) {
            closeExpenseModal();
            loadExpenses();
            showNotification('Expense saved successfully', 'success');
        } else {
            showNotification('Failed to save expense', 'error');
        }
    } catch (error) {
        console.error('Error saving expense:', error);
        showNotification('Error saving expense', 'error');
    } finally {
        modalLoading.style.display = 'none';
        saveBtn.disabled = false;
    }
}

async function loadExpenses() {
    const loading = document.getElementById('expenses-loading');
    const tableBody = document.getElementById('expenses-table-body');
    
    loading.style.display = 'flex';
    
    try {
        await DataModule.fetchExpenses();
        
        // Calculate monthly and yearly totals
        const now = new Date();
        const currentMonth = now.getMonth();
        const currentYear = now.getFullYear();
        
        let monthlyTotal = 0;
        let yearlyTotal = 0;
        
        expenses.forEach(expense => {
            const expenseDate = new Date(expense.date);
            
            if (expenseDate.getMonth() === currentMonth && expenseDate.getFullYear() === currentYear) {
                monthlyTotal += expense.amount;
            }
            
            if (expenseDate.getFullYear() === currentYear) {
                yearlyTotal += expense.amount;
            }
        });
        
        document.getElementById('monthly-expenses-total').textContent = formatCurrency(monthlyTotal);
        document.getElementById('yearly-expenses-total').textContent = formatCurrency(yearlyTotal);
        
        // Populate expense table
        if (expenses.length === 0) {
            tableBody.innerHTML = `
                <tr>
                    <td colspan="5" style="text-align: center;">No expenses data available</td>
                </tr>
            `;
        } else {
            tableBody.innerHTML = '';
            
            expenses.slice(0, 20).forEach(expense => {
                const row = document.createElement('tr');
                
                row.innerHTML = `
                    <td>${formatDate(expense.date)}</td>
                    <td>${expense.description}</td>
                    <td>${expense.category}</td>
                    <td>${formatCurrency(expense.amount)}</td>
                    <td>
                        <div class="action-buttons">
                            <button class="btn-edit" onclick="editExpense('${expense.id}')" title="Edit Expense">
                                <i class="fas fa-edit"></i>
                            </button>
                            <button class="btn-delete" onclick="deleteExpense('${expense.id}')" title="Delete Expense">
                                <i class="fas fa-trash"></i>
                            </button>
                        </div>
                    </td>
                `;
                
                tableBody.appendChild(row);
            });
        }
        
        // Create expense categories chart
        createExpenseCategoriesChart();
    } catch (error) {
        console.error('Error loading expenses:', error);
        showNotification('Error loading expenses', 'error');
    } finally {
        loading.style.display = 'none';
    }
}

function createExpenseCategoriesChart() {
    const chartContainer = document.getElementById('expense-categories-chart');
    if (!chartContainer) return;
    
    // Calculate totals by category
    const categoryTotals = {};
    
    expenses.forEach(expense => {
        if (!categoryTotals[expense.category]) {
            categoryTotals[expense.category] = 0;
        }
        categoryTotals[expense.category] += expense.amount;
    });
    
    // Sort categories by total
    const sortedCategories = Object.entries(categoryTotals)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5); // Top 5 categories
    
    if (sortedCategories.length === 0) {
        chartContainer.innerHTML = '<p>No expense data available</p>';
        return;
    }
    
    // Create a simple bar chart
    let maxAmount = Math.max(...sortedCategories.map(c => c[1]));
    
    let chartHTML = '<div class="simple-bar-chart">';
    
    sortedCategories.forEach(([category, amount]) => {
        const percentage = (amount / maxAmount) * 100;
        chartHTML += `
            <div class="bar-item">
                <div class="bar-label">${category}</div>
                <div class="bar-container">
                    <div class="bar" style="width: ${percentage}%"></div>
                </div>
                <div class="bar-value">${formatCurrency(amount)}</div>
            </div>
        `;
    });
    
    chartHTML += '</div>';
    chartContainer.innerHTML = chartHTML;
}

function editExpense(expenseId) {
    const expense = expenses.find(e => e.id === expenseId);
    if (expense) {
        openExpenseModal(expense);
    }
}

async function deleteExpense(expenseId) {
    if (!confirm('Are you sure you want to delete this expense?')) {
        return;
    }
    
    try {
        // Remove from local array
        expenses = expenses.filter(e => e.id !== expenseId);
        saveToLocalStorage();
        
        // Remove from database if online
        if (isOnline) {
            await supabase.from('expenses').delete().eq('id', expenseId);
        } else {
            // Add to sync queue
            addToSyncQueue({
                type: 'deleteExpense',
                id: expenseId
            });
        }
        
        loadExpenses();
        showNotification('Expense deleted successfully', 'success');
    } catch (error) {
        console.error('Error deleting expense:', error);
        showNotification('Error deleting expense', 'error');
    }
}

function filterExpenses() {
    const searchTerm = document.getElementById('expense-search').value.toLowerCase();
    const categoryFilter = document.getElementById('expense-filter-category').value;
    const dateFilter = document.getElementById('expense-filter-date').value;
    
    const filteredExpenses = expenses.filter(expense => {
        let matchesSearch = true;
        let matchesCategory = true;
        let matchesDate = true;
        
        if (searchTerm) {
            matchesSearch = expense.description.toLowerCase().includes(searchTerm) ||
                           expense.notes.toLowerCase().includes(searchTerm) ||
                           expense.receipt.toLowerCase().includes(searchTerm);
        }
        
        if (categoryFilter) {
            matchesCategory = expense.category === categoryFilter;
        }
        
        if (dateFilter) {
            matchesDate = expense.date === dateFilter;
        }
        
        return matchesSearch && matchesCategory && matchesDate;
    });
    
    const tableBody = document.getElementById('expenses-table-body');
    
    if (filteredExpenses.length === 0) {
        tableBody.innerHTML = `
            <tr>
                <td colspan="5" style="text-align: center;">No expenses match the current filters</td>
            </tr>
        `;
    } else {
        tableBody.innerHTML = '';
        
        filteredExpenses.forEach(expense => {
            const row = document.createElement('tr');
            
            row.innerHTML = `
                <td>${formatDate(expense.date)}</td>
                <td>${expense.description}</td>
                <td>${expense.category}</td>
                <td>${formatCurrency(expense.amount)}</td>
                <td>
                    <div class="action-buttons">
                        <button class="btn-edit" onclick="editExpense('${expense.id}')" title="Edit Expense">
                            <i class="fas fa-edit"></i>
                        </button>
                        <button class="btn-delete" onclick="deleteExpense('${expense.id}')" title="Delete Expense">
                            <i class="fas fa-trash"></i>
                        </button>
                    </div>
                </td>
            `;
            
            tableBody.appendChild(row);
        });
    }
}

async function refreshExpenses() {
    await loadExpenses();
    showNotification('Expenses refreshed', 'success');
}

// New UI Functions for Purchases
function showPurchasesPage() {
    const purchasesPage = document.getElementById('purchases-page');
    if (!purchasesPage) {
        createPurchasesPage();
    }
    
    showPage('purchases');
    loadPurchases();
}

function createPurchasesPage() {
    const mainContent = document.querySelector('.main-content');
    
    const purchasesPage = document.createElement('div');
    purchasesPage.id = 'purchases-page';
    purchasesPage.className = 'page-content';
    
    purchasesPage.innerHTML = `
        <div class="page-header">
            <h2>Purchase Management</h2>
            <div class="page-actions">
                <button id="add-purchase-btn" class="btn btn-primary">
                    <i class="fas fa-plus"></i> Add Purchase
                </button>
                <button id="refresh-purchases-btn" class="btn btn-secondary">
                    <i class="fas fa-sync"></i> Refresh
                </button>
            </div>
        </div>
        
        <div class="purchase-summary">
            <div class="summary-card">
                <h3>Total Purchases (This Month)</h3>
                <p id="monthly-purchases-total">${formatCurrency(0)}</p>
            </div>
            <div class="summary-card">
                <h3>Total Purchases (This Year)</h3>
                <p id="yearly-purchases-total">${formatCurrency(0)}</p>
            </div>
            <div class="summary-card">
                <h3>Suppliers</h3>
                <p id="total-suppliers">0</p>
            </div>
        </div>
        
        <div class="table-container">
            <div class="table-header">
                <h3>Recent Purchases</h3>
                <div class="table-actions">
                    <input type="text" id="purchase-search" placeholder="Search purchases...">
                    <input type="date" id="purchase-filter-date">
                </div>
            </div>
            <div class="loading" id="purchases-loading" style="display: none;">
                <i class="fas fa-spinner fa-spin"></i> Loading purchases...
            </div>
            <table class="data-table">
                <thead>
                    <tr>
                        <th>Date</th>
                        <th>Supplier</th>
                        <th>Description</th>
                        <th>Amount</th>
                        <th>Actions</th>
                    </tr>
                </thead>
                <tbody id="purchases-table-body">
                    <tr>
                        <td colspan="5" style="text-align: center;">No purchases data available</td>
                    </tr>
                </tbody>
            </table>
        </div>
    `;
    
    mainContent.appendChild(purchasesPage);
    
    // Add event listeners
    document.getElementById('add-purchase-btn').addEventListener('click', openPurchaseModal);
    document.getElementById('refresh-purchases-btn').addEventListener('click', refreshPurchases);
    document.getElementById('purchase-search').addEventListener('input', filterPurchases);
    document.getElementById('purchase-filter-date').addEventListener('change', filterPurchases);
}

// Create purchase modal
function createPurchaseModal() {
    const modal = document.createElement('div');
    modal.id = 'purchase-modal';
    modal.className = 'modal';
    
    modal.innerHTML = `
        <div class="modal-content">
            <div class="modal-header">
                <h3 id="purchase-modal-title">Add Purchase</h3>
                <button class="modal-close">&times;</button>
            </div>
            <div class="modal-body">
                <form id="purchase-form">
                    <div class="form-group">
                        <label for="purchase-date">Date</label>
                        <input type="date" id="purchase-date" required>
                    </div>
                    <div class="form-group">
                        <label for="purchase-supplier">Supplier</label>
                        <input type="text" id="purchase-supplier" required>
                    </div>
                    <div class="form-group">
                        <label for="purchase-description">Description</label>
                        <input type="text" id="purchase-description" required>
                    </div>
                    <div class="form-group">
                        <label for="purchase-amount">Amount</label>
                        <input type="number" id="purchase-amount" step="0.01" min="0" required>
                    </div>
                    <div class="form-group">
                        <label for="purchase-invoice">Invoice #</label>
                        <input type="text" id="purchase-invoice">
                    </div>
                    <div class="form-group">
                        <label for="purchase-notes">Notes</label>
                        <textarea id="purchase-notes" rows="3"></textarea>
                    </div>
                </form>
            </div>
            <div class="modal-footer">
                <button id="save-purchase-btn" class="btn btn-primary">Save Purchase</button>
                <button id="cancel-purchase-btn" class="btn btn-secondary">Cancel</button>
            </div>
            <div class="modal-loading" id="purchase-modal-loading" style="display: none;">
                <i class="fas fa-spinner fa-spin"></i> Saving purchase...
            </div>
        </div>
    `;
    
    document.body.appendChild(modal);
    
    // Add event listeners
    document.querySelector('#purchase-modal .modal-close').addEventListener('click', closePurchaseModal);
    document.getElementById('cancel-purchase-btn').addEventListener('click', closePurchaseModal);
    document.getElementById('save-purchase-btn').addEventListener('click', savePurchase);
    
    // Set default date to today
    document.getElementById('purchase-date').valueAsDate = new Date();
}

function openPurchaseModal(purchase = null) {
    if (!document.getElementById('purchase-modal')) {
        createPurchaseModal();
    }
    
    const modalTitle = document.getElementById('purchase-modal-title');
    const purchaseForm = document.getElementById('purchase-form');
    
    if (purchase) {
        modalTitle.textContent = 'Edit Purchase';
        document.getElementById('purchase-date').value = purchase.date;
        document.getElementById('purchase-supplier').value = purchase.supplier;
        document.getElementById('purchase-description').value = purchase.description;
        document.getElementById('purchase-amount').value = purchase.amount;
        document.getElementById('purchase-invoice').value = purchase.invoice || '';
        document.getElementById('purchase-notes').value = purchase.notes || '';
        
        purchaseForm.dataset.purchaseId = purchase.id;
    } else {
        modalTitle.textContent = 'Add Purchase';
        purchaseForm.reset();
        document.getElementById('purchase-date').valueAsDate = new Date();
        delete purchaseForm.dataset.purchaseId;
    }
    
    document.getElementById('purchase-modal').style.display = 'flex';
}

function closePurchaseModal() {
    document.getElementById('purchase-modal').style.display = 'none';
}

async function savePurchase() {
    const purchaseForm = document.getElementById('purchase-form');
    const purchaseId = purchaseForm.dataset.purchaseId;
    
    const purchaseData = {
        date: document.getElementById('purchase-date').value,
        supplier: document.getElementById('purchase-supplier').value,
        description: document.getElementById('purchase-description').value,
        amount: parseFloat(document.getElementById('purchase-amount').value),
        invoice: document.getElementById('purchase-invoice').value,
        notes: document.getElementById('purchase-notes').value
    };
    
    if (purchaseId) {
        purchaseData.id = purchaseId;
    }
    
    const modalLoading = document.getElementById('purchase-modal-loading');
    const saveBtn = document.getElementById('save-purchase-btn');
    
    modalLoading.style.display = 'flex';
    saveBtn.disabled = true;
    
    try {
        const result = await DataModule.savePurchase(purchaseData);
        
        if (result.success) {
            closePurchaseModal();
            loadPurchases();
            showNotification('Purchase saved successfully', 'success');
        } else {
            showNotification('Failed to save purchase', 'error');
        }
    } catch (error) {
        console.error('Error saving purchase:', error);
        showNotification('Error saving purchase', 'error');
    } finally {
        modalLoading.style.display = 'none';
        saveBtn.disabled = false;
    }
}

async function loadPurchases() {
    const loading = document.getElementById('purchases-loading');
    const tableBody = document.getElementById('purchases-table-body');
    
    loading.style.display = 'flex';
    
    try {
        await DataModule.fetchPurchases();
        
        // Calculate monthly and yearly totals
        const now = new Date();
        const currentMonth = now.getMonth();
        const currentYear = now.getFullYear();
        
        let monthlyTotal = 0;
        let yearlyTotal = 0;
        const suppliers = new Set();
        
        purchases.forEach(purchase => {
            const purchaseDate = new Date(purchase.date);
            
            if (purchaseDate.getMonth() === currentMonth && purchaseDate.getFullYear() === currentYear) {
                monthlyTotal += purchase.amount;
            }
            
            if (purchaseDate.getFullYear() === currentYear) {
                yearlyTotal += purchase.amount;
            }
            
            suppliers.add(purchase.supplier);
        });
        
        document.getElementById('monthly-purchases-total').textContent = formatCurrency(monthlyTotal);
        document.getElementById('yearly-purchases-total').textContent = formatCurrency(yearlyTotal);
        document.getElementById('total-suppliers').textContent = suppliers.size;
        
        // Populate purchase table
        if (purchases.length === 0) {
            tableBody.innerHTML = `
                <tr>
                    <td colspan="5" style="text-align: center;">No purchases data available</td>
                </tr>
            `;
        } else {
            tableBody.innerHTML = '';
            
            purchases.slice(0, 20).forEach(purchase => {
                const row = document.createElement('tr');
                
                row.innerHTML = `
                    <td>${formatDate(purchase.date)}</td>
                    <td>${purchase.supplier}</td>
                    <td>${purchase.description}</td>
                    <td>${formatCurrency(purchase.amount)}</td>
                    <td>
                        <div class="action-buttons">
                            <button class="btn-edit" onclick="editPurchase('${purchase.id}')" title="Edit Purchase">
                                <i class="fas fa-edit"></i>
                            </button>
                            <button class="btn-delete" onclick="deletePurchase('${purchase.id}')" title="Delete Purchase">
                                <i class="fas fa-trash"></i>
                            </button>
                        </div>
                    </td>
                `;
                
                tableBody.appendChild(row);
            });
        }
    } catch (error) {
        console.error('Error loading purchases:', error);
        showNotification('Error loading purchases', 'error');
    } finally {
        loading.style.display = 'none';
    }
}

function editPurchase(purchaseId) {
    const purchase = purchases.find(p => p.id === purchaseId);
    if (purchase) {
        openPurchaseModal(purchase);
    }
}

async function deletePurchase(purchaseId) {
    if (!confirm('Are you sure you want to delete this purchase?')) {
        return;
    }
    
    try {
        // Remove from local array
        purchases = purchases.filter(p => p.id !== purchaseId);
        saveToLocalStorage();
        
        // Remove from database if online
        if (isOnline) {
            await supabase.from('purchases').delete().eq('id', purchaseId);
        } else {
            // Add to sync queue
            addToSyncQueue({
                type: 'deletePurchase',
                id: purchaseId
            });
        }
        
        loadPurchases();
        showNotification('Purchase deleted successfully', 'success');
    } catch (error) {
        console.error('Error deleting purchase:', error);
        showNotification('Error deleting purchase', 'error');
    }
}

function filterPurchases() {
    const searchTerm = document.getElementById('purchase-search').value.toLowerCase();
    const dateFilter = document.getElementById('purchase-filter-date').value;
    
    const filteredPurchases = purchases.filter(purchase => {
        let matchesSearch = true;
        let matchesDate = true;
        
        if (searchTerm) {
            matchesSearch = purchase.supplier.toLowerCase().includes(searchTerm) ||
                           purchase.description.toLowerCase().includes(searchTerm) ||
                           purchase.notes.toLowerCase().includes(searchTerm) ||
                           purchase.invoice.toLowerCase().includes(searchTerm);
        }
        
        if (dateFilter) {
            matchesDate = purchase.date === dateFilter;
        }
        
        return matchesSearch && matchesDate;
    });
    
    const tableBody = document.getElementById('purchases-table-body');
    
    if (filteredPurchases.length === 0) {
        tableBody.innerHTML = `
            <tr>
                <td colspan="5" style="text-align: center;">No purchases match the current filters</td>
            </tr>
        `;
    } else {
        tableBody.innerHTML = '';
        
        filteredPurchases.forEach(purchase => {
            const row = document.createElement('tr');
            
            row.innerHTML = `
                <td>${formatDate(purchase.date)}</td>
                <td>${purchase.supplier}</td>
                <td>${purchase.description}</td>
                <td>${formatCurrency(purchase.amount)}</td>
                <td>
                    <div class="action-buttons">
                        <button class="btn-edit" onclick="editPurchase('${purchase.id}')" title="Edit Purchase">
                            <i class="fas fa-edit"></i>
                        </button>
                        <button class="btn-delete" onclick="deletePurchase('${purchase.id}')" title="Delete Purchase">
                            <i class="fas fa-trash"></i>
                        </button>
                    </div>
                </td>
            `;
            
            tableBody.appendChild(row);
        });
    }
}

async function refreshPurchases() {
    await loadPurchases();
    showNotification('Purchases refreshed', 'success');
}

// New UI Functions for Analytics
function showAnalyticsPage() {
    const analyticsPage = document.getElementById('analytics-page');
    if (!analyticsPage) {
        createAnalyticsPage();
    }
    
    showPage('analytics');
    loadAnalytics();
}

function createAnalyticsPage() {
    const mainContent = document.querySelector('.main-content');
    
    const analyticsPage = document.createElement('div');
    analyticsPage.id = 'analytics-page';
    analyticsPage.className = 'page-content';
    
    analyticsPage.innerHTML = `
        <div class="page-header">
            <h2>Business Analytics</h2>
            <div class="page-actions">
                <select id="analytics-period">
                    <option value="week">This Week</option>
                    <option value="month" selected>This Month</option>
                    <option value="quarter">This Quarter</option>
                    <option value="year">This Year</option>
                    <option value="custom">Custom Range</option>
                </select>
                <div id="custom-date-range" style="display: none;">
                    <input type="date" id="analytics-start-date">
                    <input type="date" id="analytics-end-date">
                </div>
                <button id="refresh-analytics-btn" class="btn btn-secondary">
                    <i class="fas fa-sync"></i> Refresh
                </button>
            </div>
        </div>
        
        <div class="analytics-summary">
            <div class="summary-card">
                <h3>Revenue</h3>
                <p id="analytics-revenue">${formatCurrency(0)}</p>
            </div>
            <div class="summary-card">
                <h3>Expenses</h3>
                <p id="analytics-expenses">${formatCurrency(0)}</p>
            </div>
            <div class="summary-card">
                <h3>Profit</h3>
                <p id="analytics-profit">${formatCurrency(0)}</p>
            </div>
            <div class="summary-card">
                <h3>Profit Margin</h3>
                <p id="analytics-profit-margin">0%</p>
            </div>
        </div>
        
        <div class="analytics-charts">
            <div class="chart-container">
                <h3>Sales Trend</h3>
                <div id="sales-trend-chart"></div>
            </div>
            <div class="chart-container">
                <h3>Top Selling Products</h3>
                <div id="top-products-chart"></div>
            </div>
        </div>
        
        <div class="analytics-alerts">
            <h3>Alerts & Discrepancies</h3>
            <div class="tabs">
                <button class="tab-btn active" data-tab="stock-alerts">Stock Alerts</button>
                <button class="tab-btn" data-tab="discrepancies">Discrepancies</button>
            </div>
            <div class="tab-content">
                <div id="stock-alerts-tab" class="tab-pane active">
                    <div class="loading" id="stock-alerts-loading" style="display: none;">
                        <i class="fas fa-spinner fa-spin"></i> Checking stock levels...
                    </div>
                    <div id="stock-alerts-list">
                        <p>No stock alerts</p>
                    </div>
                </div>
                <div id="discrepancies-tab" class="tab-pane">
                    <div class="loading" id="discrepancies-loading" style="display: none;">
                        <i class="fas fa-spinner fa-spin"></i> Checking for discrepancies...
                    </div>
                    <div id="discrepancies-list">
                        <p>No discrepancies found</p>
                    </div>
                </div>
            </div>
        </div>
    `;
    
    mainContent.appendChild(analyticsPage);
    
    // Add event listeners
    document.getElementById('refresh-analytics-btn').addEventListener('click', refreshAnalytics);
    document.getElementById('analytics-period').addEventListener('change', handleAnalyticsPeriodChange);
    
    // Tab switching
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const tabName = btn.getAttribute('data-tab');
            
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            
            document.querySelectorAll('.tab-pane').forEach(pane => pane.classList.remove('active'));
            document.getElementById(`${tabName}-tab`).classList.add('active');
        });
    });
}

async function loadAnalytics() {
    const loading = document.getElementById('analytics-loading');
    if (loading) loading.style.display = 'flex';
    
    try {
        // Get date range based on selected period
        const period = document.getElementById('analytics-period').value;
        let startDate, endDate;
        
        const today = new Date();
        endDate = today.toISOString().split('T')[0];
        
        switch (period) {
            case 'week':
                startDate = new Date(today);
                startDate.setDate(today.getDate() - 7);
                startDate = startDate.toISOString().split('T')[0];
                break;
            case 'month':
                startDate = new Date(today.getFullYear(), today.getMonth(), 1);
                startDate = startDate.toISOString().split('T')[0];
                break;
            case 'quarter':
                const quarter = Math.floor(today.getMonth() / 3);
                startDate = new Date(today.getFullYear(), quarter * 3, 1);
                startDate = startDate.toISOString().split('T')[0];
                break;
            case 'year':
                startDate = new Date(today.getFullYear(), 0, 1);
                startDate = startDate.toISOString().split('T')[0];
                break;
            case 'custom':
                startDate = document.getElementById('analytics-start-date').value;
                endDate = document.getElementById('analytics-end-date').value;
                break;
        }
        
        // Calculate profit data
        const profitInfo = DataModule.calculateProfit(startDate, endDate);
        
        // Update summary cards
        document.getElementById('analytics-revenue').textContent = formatCurrency(profitInfo.revenue);
        document.getElementById('analytics-expenses').textContent = formatCurrency(profitInfo.expenses);
        document.getElementById('analytics-profit').textContent = formatCurrency(profitInfo.profit);
        
        const profitMargin = profitInfo.revenue > 0 ? (profitInfo.profit / profitInfo.revenue * 100).toFixed(2) : 0;
        document.getElementById('analytics-profit-margin').textContent = `${profitMargin}%`;
        
        // Create sales trend chart
        createSalesTrendChart(startDate, endDate);
        
        // Create top products chart
        createTopProductsChart(startDate, endDate);
        
        // Load stock alerts
        loadStockAlerts();
        
        // Load discrepancies
        loadDiscrepancies();
    } catch (error) {
        console.error('Error loading analytics:', error);
        showNotification('Error loading analytics', 'error');
    } finally {
        if (loading) loading.style.display = 'none';
    }
}

function createSalesTrendChart(startDate, endDate) {
    const chartContainer = document.getElementById('sales-trend-chart');
    if (!chartContainer) return;
    
    // Filter sales by date range
    const filteredSales = sales.filter(sale => {
        const saleDate = new Date(sale.created_at).toISOString().split('T')[0];
        return saleDate >= startDate && saleDate <= endDate;
    });
    
    // Group sales by day
    const salesByDay = {};
    
    filteredSales.forEach(sale => {
        const saleDate = new Date(sale.created_at).toISOString().split('T')[0];
        if (!salesByDay[saleDate]) {
            salesByDay[saleDate] = 0;
        }
        salesByDay[saleDate] += sale.total;
    });
    
    // Create a simple line chart
    const dates = Object.keys(salesByDay).sort();
    const values = dates.map(date => salesByDay[date]);
    
    if (dates.length === 0) {
        chartContainer.innerHTML = '<p>No sales data for the selected period</p>';
        return;
    }
    
    let maxValue = Math.max(...values);
    
    let chartHTML = '<div class="simple-line-chart">';
    chartHTML += '<div class="chart-y-axis">';
    
    // Add Y-axis labels
    for (let i = 5; i >= 0; i--) {
        const value = (maxValue / 5) * i;
        chartHTML += `<div class="y-label">${formatCurrency(value)}</div>`;
    }
    
    chartHTML += '</div>';
    chartHTML += '<div class="chart-content">';
    chartHTML += '<div class="chart-grid">';
    
    // Add grid lines
    for (let i = 0; i <= 5; i++) {
        chartHTML += `<div class="grid-line" style="bottom: ${(100/5) * i}%"></div>`;
    }
    
    chartHTML += '</div>';
    chartHTML += '<div class="chart-data">';
    
    // Add data points and lines
    dates.forEach((date, index) => {
        const value = salesByDay[date];
        const percentage = (value / maxValue) * 100;
        
        // Add line from previous point if not the first point
        if (index > 0) {
            const prevValue = salesByDay[dates[index - 1]];
            const prevPercentage = (prevValue / maxValue) * 100;
            
            chartHTML += `
                <svg class="chart-line" style="position: absolute; left: ${(100 / (dates.length - 1)) * (index - 1)}%; width: ${(100 / (dates.length - 1))}%; height: 100%; top: 0; pointer-events: none;">
                    <line x1="0" y1="${100 - prevPercentage}%" x2="100%" y2="${100 - percentage}%" stroke="#4a6fdc" stroke-width="2" />
                </svg>
            `;
        }
        
        // Add data point
        chartHTML += `
            <div class="chart-point" style="left: ${(100 / (dates.length - 1)) * index}%; bottom: ${percentage}%" title="${date}: ${formatCurrency(value)}">
                <div class="point"></div>
                <div class="point-label">${formatDate(date, true)}</div>
            </div>
        `;
    });
    
    chartHTML += '</div>';
    chartHTML += '</div>';
    chartHTML += '</div>';
    
    chartContainer.innerHTML = chartHTML;
}

function createTopProductsChart(startDate, endDate) {
    const chartContainer = document.getElementById('top-products-chart');
    if (!chartContainer) return;
    
    // Filter sales by date range
    const filteredSales = sales.filter(sale => {
        const saleDate = new Date(sale.created_at).toISOString().split('T')[0];
        return saleDate >= startDate && saleDate <= endDate;
    });
    
    // Calculate total quantity sold for each product
    const productSales = {};
    
    filteredSales.forEach(sale => {
        sale.items.forEach(item => {
            if (!productSales[item.id]) {
                productSales[item.id] = {
                    id: item.id,
                    name: item.name,
                    quantity: 0,
                    revenue: 0
                };
            }
            
            productSales[item.id].quantity += item.quantity;
            productSales[item.id].revenue += item.price * item.quantity;
        });
    });
    
    // Sort by quantity sold
    const sortedProducts = Object.values(productSales)
        .sort((a, b) => b.quantity - a.quantity)
        .slice(0, 5); // Top 5 products
    
    if (sortedProducts.length === 0) {
        chartContainer.innerHTML = '<p>No sales data for the selected period</p>';
        return;
    }
    
    // Create a simple bar chart
    let maxQuantity = Math.max(...sortedProducts.map(p => p.quantity));
    
    let chartHTML = '<div class="simple-bar-chart">';
    
    sortedProducts.forEach(product => {
        const percentage = (product.quantity / maxQuantity) * 100;
        chartHTML += `
            <div class="bar-item">
                <div class="bar-label">${product.name}</div>
                <div class="bar-container">
                    <div class="bar" style="width: ${percentage}%"></div>
                </div>
                <div class="bar-value">${product.quantity} units</div>
            </div>
        `;
    });
    
    chartHTML += '</div>';
    chartContainer.innerHTML = chartHTML;
}

function loadStockAlerts() {
    const loading = document.getElementById('stock-alerts-loading');
    const alertsList = document.getElementById('stock-alerts-list');
    
    loading.style.display = 'flex';
    
    try {
        const alerts = DataModule.checkStockLevels();
        
        if (alerts.length === 0) {
            alertsList.innerHTML = '<p>No stock alerts</p>';
        } else {
            alertsList.innerHTML = '';
            
            alerts.forEach(alert => {
                const alertDiv = document.createElement('div');
                alertDiv.className = `alert-item ${alert.type}`;
                
                alertDiv.innerHTML = `
                    <div class="alert-icon">
                        <i class="fas ${alert.type === 'low_stock' ? 'fa-exclamation-triangle' : 'fa-clock'}"></i>
                    </div>
                    <div class="alert-content">
                        <div class="alert-message">${alert.message}</div>
                        <div class="alert-time">${formatDate(alert.created_at)}</div>
                    </div>
                    <div class="alert-actions">
                        ${alert.type === 'low_stock' ? 
                            `<button class="btn btn-sm btn-primary" onclick="restockProduct('${alert.productId}')">Restock</button>` : 
                            `<button class="btn btn-sm btn-secondary" onclick="viewProduct('${alert.productId}')">View</button>`
                        }
                    </div>
                `;
                
                alertsList.appendChild(alertDiv);
            });
        }
    } catch (error) {
        console.error('Error loading stock alerts:', error);
        alertsList.innerHTML = '<p>Error loading stock alerts</p>';
    } finally {
        loading.style.display = 'none';
    }
}

function loadDiscrepancies() {
    const loading = document.getElementById('discrepancies-loading');
    const discrepanciesList = document.getElementById('discrepancies-list');
    
    loading.style.display = 'flex';
    
    try {
        const discrepancies = DataModule.detectDiscrepancies();
        
        if (discrepancies.length === 0) {
            discrepanciesList.innerHTML = '<p>No discrepancies found</p>';
        } else {
            discrepanciesList.innerHTML = '';
            
            discrepancies.forEach(discrepancy => {
                const discrepancyDiv = document.createElement('div');
                discrepancyDiv.className = 'alert-item discrepancy';
                
                discrepancyDiv.innerHTML = `
                    <div class="alert-icon">
                        <i class="fas fa-exclamation-circle"></i>
                    </div>
                    <div class="alert-content">
                        <div class="alert-message">${discrepancy.message}</div>
                        <div class="alert-time">${formatDate(discrepancy.created_at)}</div>
                    </div>
                    <div class="alert-actions">
                        ${discrepancy.type.includes('sale') ? 
                            `<button class="btn btn-sm btn-secondary" onclick="viewSale('${discrepancy.saleId}')">View Sale</button>` : 
                            `<button class="btn btn-sm btn-secondary" onclick="viewProduct('${discrepancy.productId}')">View Product</button>`
                        }
                    </div>
                `;
                
                discrepanciesList.appendChild(discrepancyDiv);
            });
        }
    } catch (error) {
        console.error('Error loading discrepancies:', error);
        discrepanciesList.innerHTML = '<p>Error loading discrepancies</p>';
    } finally {
        loading.style.display = 'none';
    }
}

function handleAnalyticsPeriodChange() {
    const period = document.getElementById('analytics-period').value;
    const customDateRange = document.getElementById('custom-date-range');
    
    if (period === 'custom') {
        customDateRange.style.display = 'flex';
        
        // Set default dates
        const today = new Date();
        const lastMonth = new Date(today);
        lastMonth.setMonth(today.getMonth() - 1);
        
        document.getElementById('analytics-start-date').valueAsDate = lastMonth;
        document.getElementById('analytics-end-date').valueAsDate = today;
    } else {
        customDateRange.style.display = 'none';
    }
    
    loadAnalytics();
}

async function refreshAnalytics() {
    await loadAnalytics();
    showNotification('Analytics refreshed', 'success');
}

function restockProduct(productId) {
    const product = products.find(p => p.id === productId);
    if (product) {
        openProductModal(product);
    }
}

function viewProduct(productId) {
    const product = products.find(p => p.id === productId);
    if (product) {
        showPage('inventory');
        loadInventory();
        
        // Highlight the product in the table
        setTimeout(() => {
            const row = document.querySelector(`#inventory-table-body tr:has(td:first-child:contains("${productId}"))`);
            if (row) {
                row.scrollIntoView({ behavior: 'smooth', block: 'center' });
                row.classList.add('highlight');
                setTimeout(() => row.classList.remove('highlight'), 3000);
            }
        }, 500);
    }
}

// Add navigation links for the new pages
function addNavigationLinks() {
    const sidebar = document.getElementById('sidebar');
    const navLinks = sidebar.querySelector('.nav-links');
    
    // Add new navigation links
    const expensesLink = document.createElement('a');
    expensesLink.href = '#';
    expensesLink.className = 'nav-link';
    expensesLink.setAttribute('data-page', 'expenses');
    expensesLink.innerHTML = '<i class="fas fa-receipt"></i> Expenses';
    
    const purchasesLink = document.createElement('a');
    purchasesLink.href = '#';
    purchasesLink.className = 'nav-link';
    purchasesLink.setAttribute('data-page', 'purchases');
    purchasesLink.innerHTML = '<i class="fas fa-shopping-cart"></i> Purchases';
    
    const analyticsLink = document.createElement('a');
    analyticsLink.href = '#';
    analyticsLink.className = 'nav-link';
    analyticsLink.setAttribute('data-page', 'analytics');
    analyticsLink.innerHTML = '<i class="fas fa-chart-line"></i> Analytics';
    
    // Insert before the account link
    const accountLink = navLinks.querySelector('[data-page="account"]');
    navLinks.insertBefore(expensesLink, accountLink);
    navLinks.insertBefore(purchasesLink, accountLink);
    navLinks.insertBefore(analyticsLink, accountLink);
    
    // Add event listeners for the new links
    expensesLink.addEventListener('click', (e) => {
        e.preventDefault();
        showExpensesPage();
    });
    
    purchasesLink.addEventListener('click', (e) => {
        e.preventDefault();
        showPurchasesPage();
    });
    
    analyticsLink.addEventListener('click', (e) => {
        e.preventDefault();
        showAnalyticsPage();
    });
}

// Event Listeners
loginForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const email = document.getElementById('login-email').value;
    const password = document.getElementById('login-password').value;
    
    AuthModule.signIn(email, password);
});

registerForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const name = document.getElementById('register-name').value;
    const email = document.getElementById('register-email').value;
    const password = document.getElementById('register-password').value;
    const confirmPassword = document.getElementById('register-confirm-password').value;
    const role = document.getElementById('register-role').value;
    
    if (password !== confirmPassword) {
        const registerError = document.getElementById('register-error');
        if (registerError) {
            registerError.style.display = 'block';
            registerError.textContent = 'Passwords do not match';
        }
        return;
    }
    
    const registerSubmitBtn = document.getElementById('register-submit-btn');
    registerSubmitBtn.classList.add('loading');
    registerSubmitBtn.disabled = true;
    
    AuthModule.signUp(email, password, name, role)
        .then(result => {
            if (result.success) {
                const loginTab = document.querySelector('[data-tab="login"]');
                if (loginTab) loginTab.click();
                registerForm.reset();
            }
        })
        .finally(() => {
            registerSubmitBtn.classList.remove('loading');
            registerSubmitBtn.disabled = false;
        });
});

// Login tabs
document.querySelectorAll('.login-tab').forEach(tab => {
    tab.addEventListener('click', () => {
        const tabName = tab.getAttribute('data-tab');
        
        document.querySelectorAll('.login-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        
        document.querySelectorAll('.tab-content').forEach(content => {
            content.classList.remove('active');
            if (content.id === `${tabName}-tab` || content.id === `${tabName}-content`) {
                content.classList.add('active');
            }
        });
        
        const loginError = document.getElementById('login-error');
        const registerError = document.getElementById('register-error');
        if (loginError) loginError.style.display = 'none';
        if (registerError) registerError.style.display = 'none';
    });
});

// Navigation
navLinks.forEach(link => {
    link.addEventListener('click', (e) => {
        e.preventDefault();
        const pageName = link.getAttribute('data-page');
        showPage(pageName);
    });
});

// Mobile menu
if (mobileMenuBtn) {
    mobileMenuBtn.addEventListener('click', () => {
        sidebar.classList.toggle('active');
    });
}

// Logout
if (logoutBtn) {
    logoutBtn.addEventListener('click', () => {
        if (confirm('Are you sure you want to logout?')) {
            AuthModule.signOut();
        }
    });
}

// Product search
const searchBtn = document.getElementById('search-btn');
if (searchBtn) {
    searchBtn.addEventListener('click', () => {
        const productSearchEl = document.getElementById('product-search');
        const searchTerm = productSearchEl ? productSearchEl.value.toLowerCase() : '';
        
        if (!searchTerm) {
            loadProducts();
            return;
        }
        
        const filteredProducts = products.filter(product => {
            return product.name.toLowerCase().includes(searchTerm) ||
                   product.category.toLowerCase().includes(searchTerm) ||
                   (product.barcode && product.barcode.toLowerCase().includes(searchTerm));
        });
        
        if (filteredProducts.length === 0) {
            productsGrid.innerHTML = `
                <div class="empty-state">
                    <i class="fas fa-search"></i>
                    <h3>No products found</h3>
                    <p>Try a different search term</p>
                </div>
            `;
            return;
        }
        
        productsGrid.innerHTML = '';
        
        filteredProducts.forEach(product => {
            if (product.deleted) return;
            
            const productCard = document.createElement('div');
            productCard.className = 'product-card';
            
            const today = new Date();
            const expiryDate = new Date(product.expiryDate);
            const daysUntilExpiry = Math.ceil((expiryDate - today) / (1000 * 60 * 60 * 24));
            
            let expiryWarning = '';
            let productNameStyle = '';
            
            if (daysUntilExpiry < 0) {
                expiryWarning = `<div class="expiry-warning"><i class="fas fa-exclamation-triangle"></i> Expired</div>`;
                productNameStyle = 'style="color: red; font-weight: bold;"';
            } else if (daysUntilExpiry <= settings.expiryWarningDays) {
                expiryWarning = `<div class="expiry-warning"><i class="fas fa-clock"></i> Expires in ${daysUntilExpiry} days</div>`;
                productNameStyle = 'style="color: red; font-weight: bold;"';
            }
            
            let stockClass = 'stock-high';
            if (product.stock <= 0) {
                stockClass = 'stock-low';
            } else if (product.stock <= settings.lowStockThreshold) {
                stockClass = 'stock-medium';
            }
            
            productCard.innerHTML = `
                <div class="product-img">
                    <i class="fas fa-box"></i>
                </div>
                <h4 ${productNameStyle}>${product.name}</h4>
                <div class="price">${formatCurrency(product.price)}</div>
                <div class="stock ${stockClass}">Stock: ${product.stock}</div>
                ${expiryWarning}
            `;
            
            productCard.addEventListener('click', () => addToCart(product));
            productsGrid.appendChild(productCard);
        });
    });
}

// Inventory search
const inventorySearchBtn = document.getElementById('inventory-search-btn');
if (inventorySearchBtn) {
    inventorySearchBtn.addEventListener('click', () => {
        const inventorySearchEl = document.getElementById('inventory-search');
        const searchTerm = inventorySearchEl ? inventorySearchEl.value.toLowerCase() : '';
        
        if (!searchTerm) {
            loadInventory();
            return;
        }
        
        const filteredProducts = products.filter(product => {
            return product.name.toLowerCase().includes(searchTerm) ||
                   product.category.toLowerCase().includes(searchTerm) ||
                   product.id.toLowerCase().includes(searchTerm);
        });
        
        if (filteredProducts.length === 0) {
            inventoryTableBody.innerHTML = `
                <tr>
                    <td colspan="8" style="text-align: center;">No products found</td>
                </tr>
            `;
            const inventoryTotalValue = document.getElementById('inventory-total-value');
            if (inventoryTotalValue) inventoryTotalValue.textContent = formatCurrency(0);
            return;
        }
        
        let totalValue = 0;
        inventoryTableBody.innerHTML = '';
        
        filteredProducts.forEach(product => {
            if (product.deleted) return;
            
            totalValue += product.price * product.stock;
            
            const today = new Date();
            const expiryDate = new Date(product.expiryDate);
            const daysUntilExpiry = Math.ceil((expiryDate - today) / (1000 * 60 * 60 * 24));
            
            let rowClass = '';
            let stockBadgeClass = 'stock-high';
            let stockBadgeText = 'In Stock';
            let productNameStyle = '';
            
            if (product.stock <= 0) {
                stockBadgeClass = 'stock-low';
                stockBadgeText = 'Out of Stock';
            } else if (product.stock <= settings.lowStockThreshold) {
                stockBadgeClass = 'stock-medium';
                stockBadgeText = 'Low Stock';
            }
            
            let expiryBadgeClass = 'expiry-good';
            let expiryBadgeText = 'Good';
            
            if (daysUntilExpiry < 0) {
                expiryBadgeClass = 'expiry-expired';
                expiryBadgeText = 'Expired';
                rowClass = 'expired';
                productNameStyle = 'style="color: red; font-weight: bold;"';
            } else if (daysUntilExpiry <= settings.expiryWarningDays) {
                expiryBadgeClass = 'expiry-warning';
                expiryBadgeText = 'Expiring Soon';
                rowClass = 'expiring-soon';
                productNameStyle = 'style="color: red; font-weight: bold;"';
            }
            
            const row = document.createElement('tr');
            if (rowClass) row.className = rowClass;
            
            let actionButtons = '';
            if (AuthModule.isAdmin()) {
                actionButtons = `
                    <div class="action-buttons">
                        <button class="btn-edit" onclick="editProduct('${product.id}')">
                            <i class="fas fa-edit"></i>
                        </button>
                        <button class="btn-delete" onclick="deleteProduct('${product.id}')">
                            <i class="fas fa-trash"></i>
                        </button>
                    </div>
                `;
            } else {
                actionButtons = '<span class="no-permission">Admin only</span>';
            }
            
            row.innerHTML = `
                <td>${product.id}</td>
                <td ${productNameStyle}>${product.name}</td>
                <td>${product.category}</td>
                <td>${formatCurrency(product.price)}</td>
                <td>${product.stock}</td>
                <td>${formatDate(product.expiryDate)}</td>
                <td>
                    <span class="stock-badge ${stockBadgeClass}">${stockBadgeText}</span>
                    <span class="expiry-badge ${expiryBadgeClass}">${expiryBadgeText}</span>
                </td>
                <td>
                    ${actionButtons}
                </td>
            `;
            
            inventoryTableBody.appendChild(row);
        });
        
        const inventoryTotalValue = document.getElementById('inventory-total-value');
        if (inventoryTotalValue) inventoryTotalValue.textContent = formatCurrency(totalValue);
    });
}

// Product buttons
const addProductBtn = document.getElementById('add-product-btn');
if (addProductBtn) {
    addProductBtn.addEventListener('click', () => {
        openProductModal();
    });
}

const addInventoryBtn = document.getElementById('add-inventory-btn');
if (addInventoryBtn) {
    addInventoryBtn.addEventListener('click', () => {
        openProductModal();
    });
}

const saveProductBtn = document.getElementById('save-product-btn');
if (saveProductBtn) {
    saveProductBtn.addEventListener('click', saveProduct);
}

const cancelProductBtn = document.getElementById('cancel-product-btn');
if (cancelProductBtn) {
    cancelProductBtn.addEventListener('click', closeProductModal);
}

// Cart buttons
const clearCartBtn = document.getElementById('clear-cart-btn');
if (clearCartBtn) {
    clearCartBtn.addEventListener('click', () => {
        if (confirm('Are you sure you want to clear cart?')) {
            clearCart();
        }
    });
}

const completeSaleBtn = document.getElementById('complete-sale-btn');
if (completeSaleBtn) {
    completeSaleBtn.addEventListener('click', completeSale);
}

// Receipt modal buttons
const printReceiptBtn = document.getElementById('print-receipt-btn');
if (printReceiptBtn) {
    printReceiptBtn.addEventListener('click', printReceipt);
}

const newSaleBtn = document.getElementById('new-sale-btn');
if (newSaleBtn) {
    newSaleBtn.addEventListener('click', () => {
        receiptModal.style.display = 'none';
    });
}

// Report generation
const generateReportBtn = document.getElementById('generate-report-btn');
if (generateReportBtn) {
    generateReportBtn.addEventListener('click', generateReport);
}

// Manual sync button
const manualSyncBtn = document.getElementById('manual-sync-btn');
if (manualSyncBtn) {
    manualSyncBtn.addEventListener('click', () => {
        if (isOnline && syncQueue.length > 0) {
            processSyncQueue();
        } else if (!isOnline) {
            showNotification('Cannot sync while offline', 'warning');
        } else {
            showNotification('No data to sync', 'info');
        }
    });
}

// Refresh report button
const refreshReportBtn = document.getElementById('refresh-report-btn');
if (refreshReportBtn) {
    refreshReportBtn.addEventListener('click', async () => {
        const reportsLoading = document.getElementById('reports-loading');
        if (reportsLoading) reportsLoading.style.display = 'flex';
        
        try {
            await refreshAllData();
            generateReport();
            showNotification('Report data refreshed successfully', 'success');
        } catch (error) {
            console.error('Error refreshing report data:', error);
            showNotification('Error refreshing report data', 'error');
        } finally {
            if (reportsLoading) reportsLoading.style.display = 'none';
        }
    });
}

// Modal close buttons
document.querySelectorAll('.modal-close').forEach(btn => {
    btn.addEventListener('click', () => {
        btn.closest('.modal').style.display = 'none';
    });
});

// Change password form
const changePasswordForm = document.getElementById('change-password-form');
if (changePasswordForm) {
    changePasswordForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const currentPasswordEl = document.getElementById('current-password');
        const newPasswordEl = document.getElementById('new-password');
        const confirmPasswordEl = document.getElementById('confirm-new-password');
        
        const currentPassword = currentPasswordEl ? currentPasswordEl.value : '';
        const newPassword = newPasswordEl ? newPasswordEl.value : '';
        const confirmPassword = confirmPasswordEl ? confirmPasswordEl.value : '';
        
        if (newPassword !== confirmPassword) {
            showNotification('Passwords do not match', 'error');
            return;
        }
        
        const changePasswordBtn = document.getElementById('change-password-btn');
        changePasswordBtn.classList.add('loading');
        changePasswordBtn.disabled = true;
        
        try {
            const { error } = await supabase.auth.signInWithPassword({
                email: currentUser.email,
                password: currentPassword
            });
            
            if (error) throw error;
            
            const { error: updateError } = await supabase.auth.updateUser({
                password: newPassword
            });
            
            if (updateError) throw updateError;
            
            showNotification('Password changed successfully', 'success');
            changePasswordForm.reset();
        } catch (error) {
            console.error('Error changing password:', error);
            showNotification('Failed to change password: ' + error.message, 'error');
        } finally {
            changePasswordBtn.classList.remove('loading');
            changePasswordBtn.disabled = false;
        }
    });
}

// Initialize app
async function init() {
    loadFromLocalStorage();
    loadSyncQueue();
    validateDataStructure();
    cleanupDuplicateSales();
    validateSalesData();
    cleanupSyncQueue();
    
    // Add navigation links for new features
    addNavigationLinks();
    
    try {
        const { data: { session }, error } = await supabase.auth.getSession();
        
        if (session && !error) {
            const savedUser = localStorage.getItem(STORAGE_KEYS.CURRENT_USER);
            if (savedUser) {
                try {
                    const parsedUser = JSON.parse(savedUser);
                    if (parsedUser.id === session.user.id) {
                        currentUser = parsedUser;
                        
                        showApp();
                        
                        if (isOnline && syncQueue.length > 0) {
                            setTimeout(() => {
                                processSyncQueue();
                            }, 2000);
                        }
                        
                        return;
                    }
                } catch (e) {
                    console.error('Error parsing saved user data:', e);
                }
            }
            
            try {
                const { data: userData, error: userError } = await supabase
                    .from('users')
                    .select('*')
                    .eq('id', session.user.id)
                    .single();
                
                if (!userError && userData) {
                    currentUser = userData;
                    localStorage.setItem(STORAGE_KEYS.CURRENT_USER, JSON.stringify(currentUser));
                    
                    showApp();
                    
                    if (isOnline && syncQueue.length > 0) {
                        setTimeout(() => {
                            processSyncQueue();
                        }, 2000);
                    }
                    
                    return;
                } else {
                    throw userError || new Error('User not found');
                }
            } catch (fetchError) {
                if (fetchError.message && fetchError.message.includes('infinite recursion')) {
                    showNotification('Database policy issue detected. Using limited functionality.', 'warning');
                }
                
                const fallbackUser = {
                    id: session.user.id,
                    name: session.user.user_metadata?.name || session.user.email?.split('@')[0] || 'User',
                    email: session.user.email,
                    role: session.user.user_metadata?.role || 'cashier',
                    created_at: session.user.created_at,
                    last_login: new Date().toISOString()
                };
                
                currentUser = fallbackUser;
                localStorage.setItem(STORAGE_KEYS.CURRENT_USER, JSON.stringify(currentUser));
                
                showApp();
                
                if (isOnline && syncQueue.length > 0) {
                    setTimeout(() => {
                        processSyncQueue();
                    }, 2000);
                }
                
                return;
            }
        }
    } catch (sessionError) {
        console.error('Error checking session:', sessionError);
    }
    
    AuthModule.onAuthStateChanged(async (user) => {
        if (user) {
            if (!currentUser || currentUser.id !== user.id) {
                try {
                    const { data, error } = await supabase
                        .from('users')
                        .select('*')
                        .eq('id', user.id)
                        .single();
                    
                    if (!error && data) {
                        currentUser = data;
                        localStorage.setItem(STORAGE_KEYS.CURRENT_USER, JSON.stringify(currentUser));
                    }
                } catch (error) {
                    console.error('Error fetching user data:', error);
                }
            }
            
            showApp();
            
            if (isOnline && syncQueue.length > 0) {
                setTimeout(() => {
                    processSyncQueue();
                }, 2000);
            }
        } else {
            showLogin();
        }
    });
    
    showPage('pos');
    
    if (isOnline) {
        checkSupabaseConnection();
    }
    
    // Check stock levels periodically
    setInterval(() => {
        if (currentPage === 'analytics') {
            loadStockAlerts();
        }
    }, 60000); // Check every minute
    
    // Refresh session every 30 minutes
    setInterval(async () => {
        if (currentUser) {
            const { error } = await supabase.auth.refreshSession();
            if (error) {
                showNotification('Session expired. Please login again.', 'warning');
                AuthModule.signOut();
            }
        }
    }, 30 * 60 * 1000);
}

// Start app
init();