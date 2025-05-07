// openai-function-config.js - Functions and configuration for OpenAI Voice Agent

/**
 * Create function definitions and instructions for the OpenAI agent
 * @param {Object} restaurantData - Restaurant data to use for creating instructions
 * @returns {Object} Configuration object for OpenAI agent
 */
function createAgentConfig(restaurantData) {
    if (!restaurantData) {
        console.error('No restaurant data provided for agent configuration');
        return { instructions: "You are a helpful voice assistant." };
    }

    // Define available functions based on restaurant data
    const functions = [
        {
            name: "add_to_cart",
            description: "Add an item to the customer's cart",
            parameters: {
                type: "object",
                properties: {
                    item: {
                        type: "string",
                        description: "The name of the menu item to add"
                    },
                    quantity: {
                        type: "integer",
                        description: "The quantity of the item to add",
                        default: 1
                    },
                    size: {
                        type: "string",
                        description: "The size of the item (Small, Medium, Large, X-Large)",
                        enum: ["Small", "Medium", "Large", "X-Large"],
                        default: "Medium" 
                    },
                    customizations: {
                        type: "array",
                        items: {
                            type: "string"
                        },
                        description: "Any customizations for the item (extra toppings, etc.)"
                    }
                },
                required: ["item"]
            }
        },
        {
            name: "modify_cart_item",
            description: "Modify an existing item in the customer's cart",
            parameters: {
                type: "object",
                properties: {
                    item: {
                        type: "string",
                        description: "The name of the menu item to modify"
                    },
                    changes: {
                        type: "object",
                        properties: {
                            quantity: {
                                type: "integer",
                                description: "The new quantity of the item"
                            },
                            size: {
                                type: "string",
                                description: "The new size of the item",
                                enum: ["Small", "Medium", "Large", "X-Large"]
                            },
                            customizations: {
                                type: "array",
                                items: {
                                    type: "string"
                                },
                                description: "The new customizations for the item"
                            }
                        },
                        description: "Changes to make to the item"
                    }
                },
                required: ["item", "changes"]
            }
        },
        {
            name: "remove_from_cart",
            description: "Remove an item from the customer's cart",
            parameters: {
                type: "object",
                properties: {
                    item: {
                        type: "string",
                        description: "The name of the menu item to remove"
                    }
                },
                required: ["item"]
            }
        },
        {
            name: "clear_cart",
            description: "Clear all items from the customer's cart",
            parameters: {
                type: "object",
                properties: {}
            }
        },
        {
            name: "checkout",
            description: "Process the customer's order for checkout",
            parameters: {
                type: "object",
                properties: {
                    delivery: {
                        type: "boolean",
                        description: "Whether the customer wants delivery or pickup",
                        default: true
                    },
                    address: {
                        type: "string",
                        description: "Delivery address if applicable"
                    },
                    phone: {
                        type: "string",
                        description: "Customer's phone number"
                    }
                }
            }
        },
        {
            name: "update_customer_name",
            description: "Update the customer's name for the order",
            parameters: {
                type: "object",
                properties: {
                    name: {
                        type: "string",
                        description: "The customer's name"
                    }
                },
                required: ["name"]
            }
        },
        {
            name: "update_customer_phone_number",
            description: "Update the customer's phone number for the order",
            parameters: {
                type: "object",
                properties: {
                    phone: {
                        type: "string",
                        description: "The customer's phone number"
                    }
                },
                required: ["phone"]
            }
        },
        {
            name: "update_customer_address",
            description: "Update the customer's address for delivery",
            parameters: {
                type: "object",
                properties: {
                    address: {
                        type: "string",
                        description: "The customer's delivery address"
                    }
                },
                required: ["address"]
            }
        }
    ];

    // Create detailed instructions with restaurant data
    const instructions = createDetailedInstructions(restaurantData);

    return {
        instructions,
        tools: functions.map(fn => ({ type: "function", function: fn }))
    };
}

/**
 * Create detailed instructions based on restaurant data
 * @param {Object} data - Restaurant data
 * @returns {string} Detailed instructions for the agent
 */
function createDetailedInstructions(data) {
    // Format the instructions with menu information
    const instructions = `
You are a voice assistant for ${data.name}, a pizza restaurant. Your job is to help customers place orders by having a natural conversation and using functions to manage their cart.

THE MENU:
PIZZAS:
${data.menu.pizzas.map(p => `- ${p.name}: $${p.price} - ${p.description}`).join('\n')}

SIDES:
${data.menu.sides.map(s => `- ${s.name}: $${s.price} - ${s.description}`).join('\n')}

DRINKS:
${data.menu.drinks.map(d => `- ${d.name}: $${d.price} - ${d.description}`).join('\n')}

DESSERTS:
${data.menu.desserts.map(d => `- ${d.name}: $${d.price} - ${d.description}`).join('\n')}

CUSTOMIZATION OPTIONS:
Crusts: ${data.customizations.crusts.join(', ')}
Sizes: ${data.customizations.sizes.map(s => s.name).join(', ')}
Toppings: ${data.customizations.toppings.map(t => t.name).join(', ')}

SPECIAL DEALS:
${data.deals ? data.deals.map(d => `- ${d.name}: $${d.price} - ${d.description} ${d.savings}`).join('\n') : 'No special deals available'}

RESTAURANT HOURS:
${Object.entries(data.hours).map(([day, hours]) => `${day}: ${hours.open} - ${hours.close}`).join('\n')}

DELIVERY INFORMATION:
Minimum Order: $${data.delivery.minimum}
Delivery Fee: $${data.delivery.fee}
Estimated Time: ${data.delivery.estimatedTime}
Delivery Radius: ${data.delivery.radiusInMiles} miles

INSTRUCTIONS FOR CART MANAGEMENT:
1. When a customer wants to add an item to their cart, use the add_to_cart function.
2. When a customer wants to modify an item, use the modify_cart_item function.
3. When a customer wants to remove an item, use the remove_from_cart function.
4. When a customer wants to clear their entire cart, use the clear_cart function.
5. When a customer is ready to check out, use the checkout function.
6. When the customer shares their phone number use the update_customer_phone_number function.
7. When the customer shares their address use the update_customer_address function.
8. When the customer shares their name use the update_customer_name function.

IMPORTANT CONVERSATIONAL GUIDELINES:
1. This BOT will be in use in Pakistan, so expect the customer to speak in Urdu or English. Always reply in the language the customer is using. You can use a mix response of Urdu and English. However, DO NOT use HINDI at all in transcription or in Speech.
2. Be friendly, helpful, and conversational.
3. Ask clarifying questions when needed (e.g., "What size would you like?" or "Would you like any toppings on that?").
4. Confirm orders before adding them to the cart.
5. Suggest complementary items (e.g., suggest drinks when ordering pizza).
6. When using functions, maintain a natural conversation flow.
7. Always acknowledge function results in your responses (e.g., "I've added that to your cart").
8. If a customer interrupts you, stop talking and listen to their request.
9. Do not return the text in markdown format, as the speech tries to read the markdown.
10. Return phone numbers in the format of 1234567890.
11. Always ask customer for delivery or pickup and in case of delivery always ask for customer name, address and phone number before check out and ask address only if its a delivery order.
12. When you have all the information for checkout, call the checkout function and provide the customer with a summary of their order, including the total cost and estimated delivery time.

Remember that you are representing ${data.name}, so maintain a professional and welcoming tone throughout the conversation.`;

    return instructions;
}

module.exports = {
    createAgentConfig,
    createDetailedInstructions
};